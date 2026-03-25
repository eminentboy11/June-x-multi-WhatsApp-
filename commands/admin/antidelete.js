/**
 * AntiDelete — recovers deleted messages (text, image, video, audio, sticker).
 *
 * Baileys v7 RC9: deletions arrive as `messages.update` with
 *   messageStubType === WAMessageStubType.REVOKE (1).
 * Structure of each REVOKE item:
 *   {
 *     key:    { remoteJid, fromMe, participant, id: <DELETED_MSG_ID> },
 *     update: { message: null, messageStubType: 1, key: <protocol_key> }
 *   }
 *
 * Media recovery: WhatsApp CDN URLs + decryption keys live inside the stored
 * message object (imageMessage.url, imageMessage.mediaKey …).
 * We store the full inner message at receipt time so we can download + resend later.
 */

const fs       = require('fs');
const path     = require('path');
const config   = require('../../config');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

const CONFIG_PATH = path.join(__dirname, '../../data/antidelete.json');

// In-memory store: Map<chatId, Map<msgId, StoredEntry>>
// StoredEntry: { sender, type, text, inner, timestamp }
//   inner = the unwrapped Baileys message object (has CDN URL + mediaKey + fileEncSha256 etc.)
const messageStore = new Map();

const loadConfig = () => {
    try {
        if (!fs.existsSync(CONFIG_PATH)) fs.writeFileSync(CONFIG_PATH, '{}');
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch { return {}; }
};
const saveConfig = (cfg) => {
    try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2)); } catch {}
};

// Media type → Baileys download type string
const MEDIA_MAP = {
    imageMessage:    'image',
    videoMessage:    'video',
    audioMessage:    'audio',
    stickerMessage:  'sticker',
    documentMessage: 'document',
};

/**
 * Unwrap ephemeral / viewOnce wrappers to get the actual inner message.
 */
function unwrap(raw) {
    return (
        raw.ephemeralMessage?.message ||
        raw.viewOnceMessageV2Extension?.message ||
        raw.viewOnceMessageV2?.message ||
        raw.viewOnceMessage?.message ||
        raw
    );
}

/**
 * Called for every incoming message (from handler.js messages.upsert).
 * Stores text + full media object so we can re-download on delete.
 */
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

        // Find media type
        const mtype = Object.keys(MEDIA_MAP).find(k => inner[k]);

        if (!text && !mtype) return; // nothing recoverable

        const entry = {
            sender,
            timestamp:  msg.messageTimestamp,
            type:       mtype ? MEDIA_MAP[mtype] : 'text',
            mtype:      mtype || null,  // e.g. 'imageMessage'
            inner,                      // full unwrapped message — holds CDN URL + keys
            text:       text || null,
        };

        if (!messageStore.has(chatId)) messageStore.set(chatId, new Map());
        const chatMap = messageStore.get(chatId);
        chatMap.set(msg.key.id, entry);

        // Keep last 500 per chat
        if (chatMap.size > 500) chatMap.delete(chatMap.keys().next().value);
    } catch (_) {}
};

/**
 * Download media from the stored inner message and return a Buffer.
 * Returns null if download fails.
 */
async function downloadMedia(stored) {
    try {
        const { inner, mtype } = stored;
        const dlType = MEDIA_MAP[mtype];
        const stream = await downloadContentFromMessage(inner[mtype], dlType);
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        return Buffer.concat(chunks);
    } catch (e) {
        console.error('[ANTIDELETE] media download failed:', e.message);
        return null;
    }
}

/**
 * Build and send the recovery message to targetJid.
 */
async function sendRecovered(sock, targetJid, stored) {
    const senderNum  = stored.sender?.split('@')[0]?.split(':')[0] || 'Unknown';
    const typeEmoji  = {
        image: '🖼️', video: '🎬', audio: '🎵',
        sticker: '🧩', document: '📄', text: '📝'
    }[stored.type] || '📝';

    const header =
        `🗑️ *AntiDelete — Recovered*\n` +
        `👤 *From:* @${senderNum}\n` +
        `${typeEmoji} *Type:* ${stored.type}`;

    const mentions = stored.sender ? [stored.sender] : [];

    if (stored.type === 'text') {
        await sock.sendMessage(targetJid, {
            text: `${header}\n\n📝 *Message:*\n${stored.text}`,
            mentions
        });
        return;
    }

    // --- Media ---
    const buffer = await downloadMedia(stored);

    // Caption shown under the media
    const caption =
        `${header}` +
        (stored.text ? `\n\n📝 *Caption:*\n${stored.text}` : '');

    if (!buffer) {
        // Fallback: tell what was deleted but couldn't download
        await sock.sendMessage(targetJid, {
            text: `${header}\n\n⚠️ _Media could not be downloaded (expired CDN link)._`,
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
            audio: buffer,
            ptt: isVoice,
            mimetype: stored.inner?.audioMessage?.mimetype || 'audio/ogg; codecs=opus',
        });
        // Send header separately since audio can't carry caption
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
            caption,
            mentions,
        });
    }
}

/**
 * Called from handler.js when `messages.update` fires with REVOKE items.
 * `revokeItems` = array of update items already filtered for messageStubType REVOKE.
 */
const handleDelete = async (sock, revokeItems) => {
    try {
        const cfg = loadConfig();

        for (const item of revokeItems) {
            const chatId    = item.key?.remoteJid;
            const deletedId = item.key?.id;
            if (!chatId || !deletedId) continue;

            const chatCfg = cfg[chatId];
            if (!chatCfg?.mode || chatCfg.mode === 'off') continue;

            const chatMap = messageStore.get(chatId);
            if (!chatMap) continue;
            const stored = chatMap.get(deletedId);
            if (!stored) continue;

            // Resolve target JID
            let targetJid = chatId; // default: 'chat' mode
            if (chatCfg.mode === 'private') {
                const ownerNum = (config.ownerNumber || []).find(n => n);
                if (!ownerNum) continue;
                targetJid = ownerNum.includes('@') ? ownerNum : `${ownerNum}@s.whatsapp.net`;
            }

            await sendRecovered(sock, targetJid, stored);
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
        const sub     = (args[0] || '').toLowerCase();
        const cfg     = loadConfig();
        const chatCfg = cfg[from] || { mode: 'off' };

        const statusLabel = () => {
            if (!chatCfg.mode || chatCfg.mode === 'off') return '❌ OFF';
            if (chatCfg.mode === 'chat')    return '✅ ON — Chat';
            if (chatCfg.mode === 'private') return '✅ ON — Private (owner DM)';
            return chatCfg.mode;
        };

        if (!sub || sub === 'status') {
            return reply(
                `🗑️ *Anti-Delete*\n` +
                `━━━━━━━━━━━━━━━\n` +
                `📌 Status: *${statusLabel()}*\n\n` +
                `Recovers: text · image · video · audio · sticker · document\n\n` +
                `*Commands:*\n` +
                `  .antidelete chat     — reveal in this chat\n` +
                `  .antidelete private  — send to owner's DM silently\n` +
                `  .antidelete off      — disable\n` +
                `  .antidelete status   — show current setting`
            );
        }

        if (sub === 'on' || sub === 'chat') {
            chatCfg.mode = 'chat';
            cfg[from] = chatCfg;
            saveConfig(cfg);
            return reply('✅ *Anti-Delete* enabled — recovered messages will appear in *this chat*.');
        }

        if (sub === 'private') {
            chatCfg.mode = 'private';
            cfg[from] = chatCfg;
            saveConfig(cfg);
            return reply('✅ *Anti-Delete* enabled — recovered messages sent *privately to owner\'s DM*.');
        }

        if (sub === 'off') {
            chatCfg.mode = 'off';
            cfg[from] = chatCfg;
            saveConfig(cfg);
            return reply('❌ *Anti-Delete* disabled.');
        }

        return reply('⚠️ Usage: .antidelete chat | private | off | status');
    }
};
