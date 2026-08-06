/**
 * AntiEdit — catches message edits and reveals the original content.
 */

const fs     = require('fs');
const path   = require('path');
const config = require(require('path').join(global.__ROOT__, 'config'));

const CONFIG_PATH = path.join(__dirname, '../../data/antiedit.json');

function loadConfig() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) fs.writeFileSync(CONFIG_PATH, JSON.stringify({ mode: 'off' }, null, 2));
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch { return { mode: 'off' }; }
}

function saveConfig(cfg) {
    try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2)); } catch {}
}

function getMode() {
    return loadConfig().mode || 'off';
}

function setMode(mode) {
    saveConfig({ mode });
}

const messageStore = new Map();

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
        chatMap.set(msg.key.id, {
            sender,
            timestamp: msg.messageTimestamp,
            text,
            pushName: msg.pushName || null,
        });
        if (chatMap.size > 300) chatMap.delete(chatMap.keys().next().value);
    } catch (_) {}
}

function botSelfJid(sock) {
    const id = sock.user?.id;
    if (!id) return null;
    return id.includes(':') ? id.split(':')[0] + '@s.whatsapp.net' : id;
}

async function handleAntiEdit(sock, updates) {
    const mode = getMode();
    if (mode === 'off') return;

    const selfJid = botSelfJid(sock);

    for (const { key, update } of updates) {
        try {
            const proto = update?.message?.protocolMessage;
            const newMsg =
                proto?.editedMessage ||
                update?.message?.editedMessage?.message ||
                null;

            if (!newMsg) continue;

            const chatId        = key.remoteJid;
            const originalMsgId = proto?.key?.id || key.id;
            const targetJid     = mode === 'pm' && selfJid ? selfJid : chatId;
            const original      = messageStore.get(chatId)?.get(originalMsgId);
            const originalText  = original?.text || null;

            const rawSender = original?.sender || key.participant || key.remoteJid || '';
            const sender    = rawSender.includes(':')
                ? rawSender.split(':')[0] + '@s.whatsapp.net'
                : rawSender;
            const senderNum = sender.split('@')[0];

            const editedText =
                newMsg.conversation ||
                newMsg.extendedTextMessage?.text ||
                null;

            if (!editedText) continue;
            if (originalText && originalText === editedText) continue;

            const timestamp = original?.timestamp
                ? new Date(original.timestamp * 1000).toLocaleString('en-GB', {
                    hour12: false,
                    timeZone: config.timezone || 'Africa/Nairobi',
                    day: '2-digit', month: '2-digit', year: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  })
                : new Date().toLocaleString();

            const isGroup   = chatId.endsWith('@g.us');
            const chatLabel = targetJid !== chatId
                ? `\n💬 *${isGroup ? 'Group' : 'DM'}:* ${chatId.split('@')[0]}`
                : '';

            const chatType  = isGroup ? '👥 Group' : '💬 Private Chat';
            const readmore  = String.fromCharCode(8206).repeat(4001);

            const replyText =
                `✏️ *EDITED MESSAGE* ✏️\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `👤 *Sender:* @${senderNum}\n` +
                `📌 *Chat:* ${chatType}\n` +
                `🕐 *Time:* ${timestamp}` +
                chatLabel + '\n' +
                `━━━━━━━━━━━━━━━━━━━━\n${readmore}\n` +
                `📝 *Original:*\n${originalText || '_Empty_'}\n\n` +
                `📝 *Edited to:*\n${editedText}\n` +
                `━━━━━━━━━━━━━━━━━━━━`;

            await sock.sendMessage(targetJid, {
                text: replyText,
                mentions: sender ? [sender] : [],
            });

            if (original) {
                messageStore.get(chatId).get(originalMsgId).text = editedText;
            }
        } catch (e) {
            console.error('[ANTIEDIT] error:', e.message);
        }
    }
}

module.exports = {
    name: 'antiedit',
    aliases: ['antieditmsg', 'editdetect'],
    category: 'owner',
    description: 'Detect and reveal edited messages',
    usage: '.antiedit on | pm | chat | off | status',
    adminOnly: true,

    storeMessage,
    handleAntiEdit,

    async execute(sock, msg, args, extra) {
        const { reply } = extra;
        const sub  = (args[0] || '').toLowerCase();
        const mode = getMode();

        const statusLabel =
            mode === 'chat' ? '✅ ON — Chat' :
            mode === 'pm'   ? '✅ ON — PM'   : '❌ OFF';

        if (!sub || sub === 'status') {
            return reply(`✏️ Anti-Edit: *${statusLabel}*\n\n.antiedit on | pm | chat | off`);
        }

        if (sub === 'on' || sub === 'chat') {
            setMode('chat');
            return reply('✏️ Anti-Edit set to *ON* — edits revealed in chat.');
        }

        if (sub === 'pm') {
            setMode('pm');
            return reply('✏️ Anti-Edit set to *Private* — edits sent to bot self-chat.');
        }

        if (sub === 'off') {
            setMode('off');
            return reply('✏️ Anti-Edit set to *OFF*.');
        }

        return reply('⚠️ Usage: .antiedit on | pm | chat | off | status');
    }
};
