/**
 * AntiEdit — catches message edits and reveals the original content.
 *
 * Modes:
 *   chat    → post the reveal in the same chat
 *   private → global mode — ALL edited msgs across ALL chats go to owner's DM
 *   off     → disabled for the current chat
 *
 * Config keys in data/antiedit.json:
 *   "_global" : { mode: "private" }  — applies across every chat
 *   "<chatJid>": { mode: "chat"|"off" }  — per-chat override
 */

const fs     = require('fs');
const path   = require('path');
const config = require(require('path').join(global.__ROOT__, 'config'));

const CONFIG_PATH = path.join(__dirname, '../../data/antiedit.json');

function loadConfig() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) fs.writeFileSync(CONFIG_PATH, '{}');
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch { return {}; }
}

function saveConfig(cfg) {
    try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2)); } catch {}
}

function getMode(chatId) {
    const cfg        = loadConfig();
    const globalMode = cfg['_global']?.mode;
    if (globalMode === 'private') return 'private'; // global overrides
    return cfg[chatId]?.mode || 'off';
}

function setMode(chatId, mode) {
    const cfg = loadConfig();
    cfg[chatId] = { ...(cfg[chatId] || {}), mode };
    saveConfig(cfg);
}

// ── In-memory store ───────────────────────────────────────────────────────────
const messageStore = new Map(); // Map<chatId, Map<msgId, entry>>

function storeMessage(msg) {
    try {
        if (!msg?.key?.id || !msg.message) return;
        const chatId = msg.key.remoteJid;
        const sender = msg.key.participant || msg.key.remoteJid;
        const inner  = msg.message;

        const text =
            inner.conversation ||
            inner.extendedTextMessage?.text ||
            inner.ephemeralMessage?.message?.conversation ||
            inner.ephemeralMessage?.message?.extendedTextMessage?.text ||
            null;

        if (!text) return;

        if (!messageStore.has(chatId)) messageStore.set(chatId, new Map());
        const chatMap = messageStore.get(chatId);
        chatMap.set(msg.key.id, { sender, timestamp: msg.messageTimestamp, text, pushName: msg.pushName || null });
        if (chatMap.size > 300) chatMap.delete(chatMap.keys().next().value);
    } catch (_) {}
}

function ownerJid(sock) {
    const id = sock.user?.id;
    if (!id) return null;
    return id.includes(':') ? id.split(':')[0] + '@s.whatsapp.net' : id;
}

async function handleAntiEdit(sock, updates) {
    const cfg        = loadConfig();
    const globalMode = cfg['_global']?.mode;
    const botJid     = ownerJid(sock);

    for (const { key, update } of updates) {
        try {
            const newMsg =
                update?.message?.editedMessage?.message ||
                update?.message?.protocolMessage?.editedMessage ||
                null;

            if (!newMsg) continue;

            const chatId = key.remoteJid;
            const msgId  = key.id;

            // Determine effective mode
            let targetJid;
            if (globalMode === 'private' && botJid) {
                targetJid = botJid;
            } else {
                const mode = cfg[chatId]?.mode || 'off';
                if (!mode || mode === 'off') continue;
                targetJid = mode === 'private' && botJid ? botJid : chatId;
            }

            const original     = messageStore.get(chatId)?.get(msgId);
            const originalText = original?.text || '[Original not available]';
            const sender       = original?.sender || key.participant || key.remoteJid || 'Unknown';

            const editedText =
                newMsg.conversation ||
                newMsg.extendedTextMessage?.text ||
                '[Edited content not available]';

            if (originalText !== '[Original not available]' && originalText === editedText) continue;

            const senderNum = sender.split('@')[0].split(':')[0];
            const timestamp = original?.timestamp
                ? new Date(original.timestamp * 1000).toLocaleString('en-GB', {
                    hour12: false, timeZone: config.timezone || 'Africa/Nairobi',
                    day: '2-digit', month: '2-digit', year: 'numeric',
                    hour: '2-digit', minute: '2-digit'
                  })
                : new Date().toLocaleString();

            // Show origin chat if message is going to owner DM (different JID)
            const chatLabel = targetJid !== chatId
                ? `\n💬 *Chat:* ${chatId.includes('@g.us') ? 'Group' : 'DM'} (${chatId.split('@')[0]})`
                : '';

            const readmore  = String.fromCharCode(8206).repeat(4001);
            const replyText =
                `✏️ *EDITED MESSAGE DETECTED!*\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `👤 *Sender:* @${senderNum}\n` +
                `🕐 *Time:* ${timestamp}` +
                chatLabel + '\n' +
                `━━━━━━━━━━━━━━━━━━━━\n${readmore}\n` +
                `📝 *Original:*\n${originalText}\n\n` +
                `✏️ *Edited to:*\n${editedText}\n` +
                `━━━━━━━━━━━━━━━━━━━━`;

            await sock.sendMessage(targetJid, { text: replyText, mentions: [sender] });

            // Update store with latest text
            if (messageStore.has(chatId) && messageStore.get(chatId).has(msgId)) {
                messageStore.get(chatId).get(msgId).text = editedText;
            }
        } catch (e) {
            console.error('[ANTIEDIT] error:', e.message);
        }
    }
}

// ── Command module ────────────────────────────────────────────────────────────

module.exports = {
    name: 'antiedit',
    aliases: ['antieditmsg', 'editdetect'],
    category: 'admin',
    description: 'Detect and reveal edited messages',
    usage: '.antiedit on | off | chat | private | status',
    adminOnly: true,

    storeMessage,
    handleAntiEdit,

    async execute(sock, msg, args, extra) {
        const { from, reply } = extra;
        const sub = (args[0] || '').toLowerCase();

        const cfg        = loadConfig();
        const globalMode = cfg['_global']?.mode;
        const chatMode   = cfg[from]?.mode;

        const statusLabel = () => {
            if (globalMode === 'private') return '✅ ON — Private *[GLOBAL — all chats → owner DM]*';
            if (!chatMode || chatMode === 'off') return '❌ OFF';
            if (chatMode === 'chat')    return '✅ ON — Chat (revealed here)';
            if (chatMode === 'private') return '✅ ON — Private (this chat → owner DM)';
            return chatMode;
        };

        if (!sub || sub === 'status') {
            return reply(
                `✏️ *Anti-Edit*\n` +
                `━━━━━━━━━━━━━━━\n` +
                `📌 Status: *${statusLabel()}*\n\n` +
                `Catches message edits and reveals the original content.\n\n` +
                `*Commands:*\n` +
                `  .antiedit on       — reveal edits in this chat\n` +
                `  .antiedit private  — *all* edits from *all* chats → owner DM\n` +
                `  .antiedit off      — disable for this chat\n` +
                `  .antiedit off all  — disable globally\n` +
                `  .antiedit status   — show current setting`
            );
        }

        if (sub === 'on' || sub === 'chat') {
            setMode(from, 'chat');
            return reply('✅ *Anti-Edit* enabled — edited messages will be revealed *in this chat*.');
        }

        if (sub === 'private') {
            cfg['_global'] = { mode: 'private' };
            saveConfig(cfg);
            return reply(
                '✅ *Anti-Edit [GLOBAL PRIVATE]* enabled.\n' +
                'All edited messages from *every chat* will be forwarded to the *owner\'s DM* silently.'
            );
        }

        if (sub === 'off') {
            if ((args[1] || '').toLowerCase() === 'all') {
                delete cfg['_global'];
                saveConfig(cfg);
                return reply('❌ *Anti-Edit* global private mode disabled.');
            }
            setMode(from, 'off');
            return reply('❌ *Anti-Edit* disabled for this chat.\n_Tip: use `.antiedit off all` to stop global private mode._');
        }

        return reply('⚠️ Usage: .antiedit on | off | off all | chat | private | status');
    }
};
