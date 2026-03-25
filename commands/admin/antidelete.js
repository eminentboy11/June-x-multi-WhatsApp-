/**
 * AntiDelete — recovers messages deleted in groups/DMs.
 *
 * Baileys v7 RC9 does NOT emit `messages.delete`.
 * Deletions arrive as `messages.update` with messageStubType === WAMessageStubType.REVOKE (1).
 * The update item structure is:
 *   {
 *     key:    { remoteJid, fromMe, participant, id: <DELETED_MSG_ID> },
 *     update: { message: null, messageStubType: 1, key: <protocol_msg_key> }
 *   }
 * So item.key.remoteJid  = chat the deletion happened in
 *    item.key.id          = original ID of the deleted message  ← look this up in our store
 */

const fs     = require('fs');
const path   = require('path');
const config = require('../../config');

const CONFIG_PATH = path.join(__dirname, '../../data/antidelete.json');

// In-memory store: Map<chatId, Map<msgId, { sender, type, text, mediaMsg, timestamp }>>
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

/**
 * Called for every incoming message from the messages.upsert handler.
 * Stores text and media content so we can recover it when the REVOKE event fires.
 */
const storeMessage = (msg) => {
    try {
        if (!msg?.key?.id || !msg.message) return;
        const chatId = msg.key.remoteJid;
        const sender = msg.key.participant || msg.key.remoteJid;
        const raw    = msg.message;

        // Unwrap common wrappers
        const inner =
            raw.ephemeralMessage?.message ||
            raw.viewOnceMessageV2?.message ||
            raw.viewOnceMessageV2Extension?.message ||
            raw.viewOnceMessage?.message ||
            raw;

        const text =
            inner.conversation ||
            inner.extendedTextMessage?.text ||
            inner.imageMessage?.caption ||
            inner.videoMessage?.caption ||
            inner.documentMessage?.caption ||
            null;

        // Determine type
        const hasMedia = !!(
            inner.imageMessage || inner.videoMessage || inner.audioMessage ||
            inner.stickerMessage || inner.documentMessage
        );

        if (!text && !hasMedia) return;

        // Store raw msg.message so we can re-send if needed (optional future feature)
        const entry = {
            sender,
            timestamp: msg.messageTimestamp,
            type: inner.imageMessage    ? 'image'
                : inner.videoMessage    ? 'video'
                : inner.audioMessage    ? 'audio'
                : inner.stickerMessage  ? 'sticker'
                : inner.documentMessage ? 'document'
                : 'text',
            text: text || null
        };

        if (!messageStore.has(chatId)) messageStore.set(chatId, new Map());
        const chatMap = messageStore.get(chatId);
        chatMap.set(msg.key.id, entry);

        // Keep last 500 per chat to avoid memory bloat
        if (chatMap.size > 500) chatMap.delete(chatMap.keys().next().value);
    } catch (_) {}
};

/**
 * Called from handler.js when a REVOKE update is received.
 * `revokeItems` = array of messages.update items already filtered for REVOKE.
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

            const senderNum  = stored.sender?.split('@')[0]?.split(':')[0] || 'Unknown';
            const isGroup    = chatId.endsWith('@g.us');
            const groupLabel = isGroup ? `\n📌 *Chat:* ${chatId.split('@')[0]}` : '';
            const typeLabel  = stored.type !== 'text' ? ` _(${stored.type})_` : '';

            const textBody =
                `🗑️ *AntiDelete — Recovered Message*\n\n` +
                `👤 *From:* @${senderNum}${typeLabel}` +
                groupLabel +
                (stored.text ? `\n\n📝 *Message:*\n${stored.text}` : '\n\n_(media message — no caption)_');

            const payload = {
                text: textBody,
                mentions: stored.sender ? [stored.sender] : []
            };

            const targetJid = chatCfg.mode === 'private'
                ? (() => {
                    const ownerNum = (config.ownerNumber || []).find(n => n);
                    if (!ownerNum) return null;
                    return ownerNum.includes('@') ? ownerNum : `${ownerNum}@s.whatsapp.net`;
                  })()
                : chatId; // 'chat' mode

            if (!targetJid) continue;
            await sock.sendMessage(targetJid, payload);
        }
    } catch (e) {
        console.error('[ANTIDELETE] Error:', e.message);
    }
};

module.exports = {
    name: 'antidelete',
    aliases: ['antidel'],
    category: 'admin',
    description: 'Recover deleted messages — send to current chat or privately to owner',
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
            if (chatCfg.mode === 'chat')    return '✅ ON — Chat (same group)';
            if (chatCfg.mode === 'private') return '✅ ON — Private (owner DM)';
            return chatCfg.mode;
        };

        if (!sub || sub === 'status') {
            return reply(
                `🗑️ *Anti-Delete*\n` +
                `━━━━━━━━━━━━━━━\n` +
                `📌 Status: *${statusLabel()}*\n\n` +
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
            return reply('✅ *Anti-Delete* enabled — recovered messages will be sent *privately to the owner\'s DM*.');
        }

        if (sub === 'off') {
            chatCfg.mode = 'off';
            cfg[from] = chatCfg;
            saveConfig(cfg);
            return reply('❌ *Anti-Delete* has been disabled.');
        }

        return reply('⚠️ Usage: .antidelete chat | private | off | status');
    }
};
