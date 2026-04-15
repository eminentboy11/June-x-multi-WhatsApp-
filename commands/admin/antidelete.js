/**
 * AntiDelete — recovers deleted messages (text, image, video, audio, sticker).
 *
 * Modes:
 *   chat    → reveals deleted msg in the same chat it was deleted from
 *   private → global mode — ALL deleted msgs across ALL chats go to owner's DM
 *   off     → disabled for the current chat (or globally if no per-chat entry)
 *
 * Config keys in data/antidelete.json:
 *   "_global" : { mode: "private" }  — applies across every chat
 *   "<chatJid>": { mode: "chat"|"off" }  — per-chat override
 */

const fs       = require('fs');
const path     = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

const CONFIG_PATH = path.join(__dirname, '../../data/antidelete.json');

const messageStore = new Map(); // Map<chatId, Map<msgId, StoredEntry>>

const loadConfig = () => {
    try {
        if (!fs.existsSync(CONFIG_PATH)) fs.writeFileSync(CONFIG_PATH, '{}');
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch { return {}; }
};
const saveConfig = (cfg) => {
    try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2)); } catch {}
};

const MEDIA_MAP = {
    imageMessage:    'image',
    videoMessage:    'video',
    audioMessage:    'audio',
    stickerMessage:  'sticker',
    documentMessage: 'document',
};

function unwrap(raw) {
    return (
        raw.ephemeralMessage?.message ||
        raw.viewOnceMessageV2Extension?.message ||
        raw.viewOnceMessageV2?.message ||
        raw.viewOnceMessage?.message ||
        raw
    );
}

const storeMessage = (msg) => {
    try {
        if (!msg?.key?.id || !msg.message) return;
        const chatId = msg.key.remoteJid;
        const sender = msg.key.participant || msg.key.remoteJid;
        const inner  = unwrap(msg.message);

        const text =
            inner.conversation ||
            inner.extendedTextMessage?.text ||
            inner.imageMessage?.caption ||
            inner.videoMessage?.caption ||
            inner.documentMessage?.caption ||
            null;

        const mtype = Object.keys(MEDIA_MAP).find(k => inner[k]);
        if (!text && !mtype) return;

        const entry = {
            sender,
            timestamp: msg.messageTimestamp,
            type:      mtype ? MEDIA_MAP[mtype] : 'text',
            mtype:     mtype || null,
            inner,
            text:      text || null,
        };

        if (!messageStore.has(chatId)) messageStore.set(chatId, new Map());
        const chatMap = messageStore.get(chatId);
        chatMap.set(msg.key.id, entry);
        if (chatMap.size > 500) chatMap.delete(chatMap.keys().next().value);
    } catch (_) {}
};

async function downloadMedia(stored) {
    try {
        const { inner, mtype } = stored;
        const stream = await downloadContentFromMessage(inner[mtype], MEDIA_MAP[mtype]);
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        return Buffer.concat(chunks);
    } catch { return null; }
}

async function sendRecovered(sock, targetJid, stored, originChat) {
    const senderNum = stored.sender?.split('@')[0]?.split(':')[0] || 'Unknown';
    const typeEmoji = {
        image: '🖼️', video: '🎬', audio: '🎵',
        sticker: '🧩', document: '📄', text: '📝'
    }[stored.type] || '📝';

    const readmore  = String.fromCharCode(8206).repeat(4001);
    const chatLabel = originChat && originChat !== targetJid
        ? `\n💬 *Chat:* ${originChat.includes('@g.us') ? 'Group' : 'DM'} (${originChat.split('@')[0]})`
        : '';

    const header =
        `🗑️ *AntiDelete — Recovered*\n${readmore}\n` +
        `👤 *From:* @${senderNum}` +
        chatLabel + '\n' +
        `${typeEmoji} *Type:* ${stored.type}`;

    const mentions = stored.sender ? [stored.sender] : [];

    if (stored.type === 'text') {
        await sock.sendMessage(targetJid, {
            text: `${header}\n\n📝 *Message:*\n${stored.text}`,
            mentions
        });
        return;
    }

    const buffer  = await downloadMedia(stored);
    const caption = header + (stored.text ? `\n\n📝 *Caption:*\n${stored.text}` : '');

    if (!buffer) {
        await sock.sendMessage(targetJid, {
            text: `${header}\n\n⚠️ _Media expired (CDN link gone)._`,
            mentions
        });
        return;
    }

    if (stored.type === 'image') {
        await sock.sendMessage(targetJid, { image: buffer, caption, mentions });
    } else if (stored.type === 'video') {
        await sock.sendMessage(targetJid, {
            video: buffer, caption, mentions,
            mimetype: stored.inner?.videoMessage?.mimetype || 'video/mp4',
        });
    } else if (stored.type === 'audio') {
        const isVoice = stored.inner?.audioMessage?.ptt === true;
        await sock.sendMessage(targetJid, {
            audio: buffer, ptt: isVoice,
            mimetype: stored.inner?.audioMessage?.mimetype || 'audio/ogg; codecs=opus',
        });
        await sock.sendMessage(targetJid, { text: header, mentions });
    } else if (stored.type === 'sticker') {
        await sock.sendMessage(targetJid, {
            sticker: buffer,
            mimetype: stored.inner?.stickerMessage?.mimetype || 'image/webp',
        });
        await sock.sendMessage(targetJid, { text: header, mentions });
    } else if (stored.type === 'document') {
        await sock.sendMessage(targetJid, {
            document: buffer,
            mimetype: stored.inner?.documentMessage?.mimetype || 'application/octet-stream',
            fileName: stored.inner?.documentMessage?.fileName || 'file',
            caption, mentions,
        });
    }
}

// Helper — resolve owner DM JID
function ownerJid(sock) {
    const id = sock.user?.id;
    if (!id) return null;
    return id.includes(':') ? id.split(':')[0] + '@s.whatsapp.net' : id;
}

const handleDelete = async (sock, revokeItems) => {
    try {
        const cfg        = loadConfig();
        const globalMode = cfg['_global']?.mode; // 'private' | undefined
        const botJid     = ownerJid(sock);

        for (const item of revokeItems) {
            const chatId    = item.key?.remoteJid;
            const deletedId = item.key?.id;
            if (!chatId || !deletedId) continue;

            // Skip status updates
            if (chatId === 'status@broadcast') continue;

            // Determine effective mode:
            //   1. If global private is on  → always send to owner DM
            //   2. Else check per-chat setting
            let targetJid;
            if (globalMode === 'private' && botJid) {
                targetJid = botJid;
            } else {
                const chatCfg = cfg[chatId];
                if (!chatCfg?.mode || chatCfg.mode === 'off') continue;
                if (chatCfg.mode === 'private' && botJid) {
                    targetJid = botJid;
                } else {
                    targetJid = chatId; // chat mode
                }
            }

            const chatMap = messageStore.get(chatId);
            if (!chatMap) continue;
            const stored = chatMap.get(deletedId);
            if (!stored) continue;

            await sendRecovered(sock, targetJid, stored, chatId);
        }
    } catch (e) {
        console.error('[ANTIDELETE] handleDelete error:', e.message);
    }
};

module.exports = {
    name: 'antidelete',
    aliases: ['antidel'],
    category: 'admin',
    description: 'Recover deleted messages (text, image, video, audio, sticker)',
    usage: '.antidelete chat/private/off/status',
    adminOnly: true,

    storeMessage,
    handleDelete,

    async execute(sock, msg, args, extra) {
        const { from, reply } = extra;
        const sub = (args[0] || '').toLowerCase();
        const cfg = loadConfig();

        const globalMode  = cfg['_global']?.mode;
        const chatMode    = cfg[from]?.mode;
        const effectiveMode = globalMode === 'private' ? 'private (global)' : (chatMode || 'off');

        const statusLabel = () => {
            if (globalMode === 'private') return '✅ ON — Private *[GLOBAL — all chats → owner DM]*';
            if (!chatMode || chatMode === 'off') return '❌ OFF';
            if (chatMode === 'chat')    return '✅ ON — Chat';
            if (chatMode === 'private') return '✅ ON — Private (this chat → owner DM)';
            return chatMode;
        };

        if (!sub || sub === 'status') {
            return reply(
                `🗑️ *Anti-Delete*\n` +
                `━━━━━━━━━━━━━━━\n` +
                `📌 Status: *${statusLabel()}*\n\n` +
                `Recovers: text · image · video · audio · sticker · document\n\n` +
                `*Commands:*\n` +
                `  .antidelete chat     — reveal in this chat only\n` +
                `  .antidelete private  — *all* deleted msgs from *all* chats → owner DM\n` +
                `  .antidelete off      — disable for this chat\n` +
                `  .antidelete off all  — disable globally\n` +
                `  .antidelete status   — show current setting`
            );
        }

        if (sub === 'on' || sub === 'chat') {
            cfg[from] = { ...(cfg[from] || {}), mode: 'chat' };
            saveConfig(cfg);
            return reply('✅ *Anti-Delete* enabled — recovered messages will appear *in this chat*.');
        }

        if (sub === 'private') {
            cfg['_global'] = { mode: 'private' };
            saveConfig(cfg);
            return reply(
                '✅ *Anti-Delete [GLOBAL PRIVATE]* enabled.\n' +
                'All deleted messages from *every chat* will be forwarded to the *owner\'s DM* silently.'
            );
        }

        if (sub === 'off') {
            if ((args[1] || '').toLowerCase() === 'all') {
                delete cfg['_global'];
                saveConfig(cfg);
                return reply('❌ *Anti-Delete* global private mode disabled.');
            }
            cfg[from] = { ...(cfg[from] || {}), mode: 'off' };
            // Also clear global if disabling locally while global is active (UX choice — skip silently)
            saveConfig(cfg);
            return reply('❌ *Anti-Delete* disabled for this chat.\n_Tip: use `.antidelete off all` to stop global private mode._');
        }

        return reply('⚠️ Usage: .antidelete chat | private | off | off all | status');
    }
};
