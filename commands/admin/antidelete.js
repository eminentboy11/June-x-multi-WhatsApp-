const fs     = require('fs');
const path   = require('path');
const config = require('../../config');

const CONFIG_PATH = path.join(__dirname, '../../data/antidelete.json');

// In-memory store: { chatId: Map<msgId, { sender, text, timestamp }> }
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
 * Store every incoming message (text only for now).
 * Called from handler.js for every message.
 */
const storeMessage = (msg) => {
    if (!msg?.message || !msg.key?.id) return;
    const chatId = msg.key.remoteJid;
    const text   =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        msg.message?.videoMessage?.caption ||
        null;
    if (!text) return;
    if (!messageStore.has(chatId)) messageStore.set(chatId, new Map());
    const chatMap = messageStore.get(chatId);
    chatMap.set(msg.key.id, {
        sender:    msg.key.participant || msg.key.remoteJid,
        text,
        timestamp: msg.messageTimestamp
    });
    // Keep last 500 per chat
    if (chatMap.size > 500) chatMap.delete(chatMap.keys().next().value);
};

/**
 * Called when messages.delete fires.
 * Reads the mode per chat and sends recovered message accordingly.
 *   mode === 'chat'    → send in the group/chat where it was deleted
 *   mode === 'private' → send to bot owner's DM
 *   mode === false/off → do nothing
 */
const handleDelete = async (sock, update) => {
    try {
        const cfg = loadConfig();
        for (const key of (update.keys || [])) {
            const chatId = key.remoteJid;
            const chatCfg = cfg[chatId];
            if (!chatCfg?.mode || chatCfg.mode === 'off') continue;

            const chatStore = messageStore.get(chatId);
            if (!chatStore) continue;
            const stored = chatStore.get(key.id);
            if (!stored) continue;

            const senderNum = stored.sender?.split('@')[0]?.split(':')[0] || 'Unknown';
            const isGroup   = chatId.endsWith('@g.us');

            const groupLabel = isGroup ? `📌 *Chat:* ${chatId.split('@')[0]}\n` : '';

            const body = {
                text: `🗑️ *AntiDelete — Recovered Message*\n\n` +
                      `👤 *From:* @${senderNum}\n` +
                      groupLabel +
                      `\n📝 *Message:*\n${stored.text}`,
                mentions: stored.sender ? [stored.sender] : []
            };

            if (chatCfg.mode === 'private') {
                // Send to owner's DM
                const ownerNum = (config.ownerNumber || []).find(n => n) || '';
                if (!ownerNum) continue;
                const ownerJid = ownerNum.includes('@') ? ownerNum : `${ownerNum}@s.whatsapp.net`;
                await sock.sendMessage(ownerJid, body);
            } else {
                // mode === 'chat'  →  send in the same chat
                await sock.sendMessage(chatId, body);
            }
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
    usage: '.antidelete on/off/private/chat/status',
    adminOnly: true,

    storeMessage,
    handleDelete,

    async execute(sock, msg, args, extra) {
        const { from, reply } = extra;
        const sub = (args[0] || '').toLowerCase();
        const cfg = loadConfig();
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
                `  .antidelete private  — send to owner's DM\n` +
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
            return reply('✅ *Anti-Delete* enabled — recovered messages will be sent *privately to the owner*.');
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
