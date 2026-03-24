const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '../../data/antidelete.json');
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

const storeMessage = (msg) => {
    if (!msg?.message || !msg.key?.id) return;
    const chatId = msg.key.remoteJid;
    const text = msg.message?.conversation
        || msg.message?.extendedTextMessage?.text
        || msg.message?.imageMessage?.caption
        || msg.message?.videoMessage?.caption
        || null;
    if (!text) return;
    if (!messageStore.has(chatId)) messageStore.set(chatId, new Map());
    messageStore.get(chatId).set(msg.key.id, {
        sender: msg.key.participant || msg.key.remoteJid,
        text,
        timestamp: msg.messageTimestamp
    });
    // Keep last 500 messages per chat
    const chatStore = messageStore.get(chatId);
    if (chatStore.size > 500) {
        const firstKey = chatStore.keys().next().value;
        chatStore.delete(firstKey);
    }
};

module.exports = {
    name: 'antidelete',
    aliases: ['antidel'],
    category: 'admin',
    description: 'Toggle antidelete — recovers deleted messages and sends them to chat',
    usage: '.antidelete on/off',
    groupOnly: true,
    adminOnly: true,

    async execute(sock, msg, args, extra) {
        const { from, reply } = extra;

        const sub = (args[0] || '').toLowerCase();
        const cfg = loadConfig();
        const groupCfg = cfg[from] || { enabled: false };

        if (!sub || !['on', 'off', 'status'].includes(sub)) {
            const status = groupCfg.enabled ? '✅ ON' : '❌ OFF';
            return reply(`🗑️ *AntiDelete*\n\nStatus: ${status}\n\nUsage:\n• *.antidelete on* — enable\n• *.antidelete off* — disable`);
        }

        if (sub === 'status') {
            return reply(`🗑️ *AntiDelete* is currently ${groupCfg.enabled ? '✅ ON' : '❌ OFF'}`);
        }

        groupCfg.enabled = sub === 'on';
        cfg[from] = groupCfg;
        saveConfig(cfg);

        await reply(`🗑️ *AntiDelete* has been turned ${groupCfg.enabled ? '✅ ON' : '❌ OFF'}.\n\n${groupCfg.enabled ? 'Deleted messages will be recovered and forwarded.' : 'Message recovery is now disabled.'}`);
    },

    storeMessage,

    async handleDelete(sock, update) {
        try {
            const cfg = loadConfig();
            for (const key of (update.keys || [])) {
                const chatId = key.remoteJid;
                if (!cfg[chatId]?.enabled) continue;
                const chatStore = messageStore.get(chatId);
                if (!chatStore) continue;
                const stored = chatStore.get(key.id);
                if (!stored) continue;
                const senderNum = stored.sender?.split('@')[0]?.split(':')[0] || 'Unknown';
                await sock.sendMessage(chatId, {
                    text: `🗑️ *AntiDelete — Recovered Message*\n\n👤 *From:* @${senderNum}\n\n📝 *Message:*\n${stored.text}`,
                    mentions: stored.sender ? [stored.sender] : []
                });
            }
        } catch (e) {
            console.error('[ANTIDELETE] Error:', e.message);
        }
    }
};
