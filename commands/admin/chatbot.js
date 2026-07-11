/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FILE    : chatbot.js                                        ║
 * ║  FEATURE : AI Chatbot — Groups + DMs                         ║
 * ║  SCOPE   : Admin (groups) / Owner (chats toggle)             ║
 * ║  API     : apis.keithsite.top — multi-endpoint with fallback ║
 * ║  CMDS    : .chatbot on | off | pm | chat                     ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * .chatbot on   → enable in group (replies to ALL messages)
 * .chatbot off  → silence / disable (group or DM)
 * .chatbot pm   → toggle auto-reply in private/DM chats (owner)
 * .chatbot chat → alias for pm
 *
 * AI API: apis.keithsite.top
 *   Tries endpoints in order until one succeeds.
 */

const axios    = require('axios');
const database = require(require('path').join(global.__CORE__, 'database'));
const config   = require(require('path').join(global.__ROOT__, 'config'));

// ── API config ────────────────────────────────────────────────────────────────
const BASE = 'https://apiskeith2-production-ec66.up.railway.app';

// Endpoints tried in order — first success wins
const AI_ENDPOINTS = [
    (q) => `${BASE}/keithai?q=${encodeURIComponent(q)}`,
    (q) => `${BASE}/ai/gpt?q=${encodeURIComponent(q)}`,
    (q) => `${BASE}/ai/chatgpt4?q=${encodeURIComponent(q)}`,
    (q) => `${BASE}/ai/gpt4?q=${encodeURIComponent(q)}`,
    (q) => `${BASE}/ai/deepseekV3?q=${encodeURIComponent(q)}`,
    (q) => `${BASE}/ai/mistral?q=${encodeURIComponent(q)}`,
];

// ── In-memory state ────────────────────────────────────────────────────────────
// Conversation history: chatJid → [ { role, text }, … ] (max 5 pairs = 10 entries)
const history = new Map();
const HISTORY_MAX = 10;

// Rate limiting: senderJid → lastRequestMs
const lastRequest = new Map();
const RATE_MS = 4000; // 4 seconds between requests per user

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a context-aware prompt from conversation history + new message.
 * Keeps the payload short so keithsite doesn't time out.
 */
function buildPrompt(chatJid, newText) {
    const hist = history.get(chatJid) || [];
    if (!hist.length) return newText;

    const ctx = hist
        .slice(-6)                         // last 3 exchanges max
        .map(h => `${h.role === 'user' ? 'User' : 'Bot'}: ${h.text}`)
        .join('\n');
    return `${ctx}\nUser: ${newText}\nBot:`;
}

/** Store a turn in conversation history, capping at HISTORY_MAX entries. */
function pushHistory(chatJid, role, text) {
    if (!history.has(chatJid)) history.set(chatJid, []);
    const h = history.get(chatJid);
    h.push({ role, text: text.slice(0, 300) }); // cap each entry at 300 chars
    if (h.length > HISTORY_MAX) h.splice(0, h.length - HISTORY_MAX);
}

/** Call the AI — tries all endpoints, returns first successful result. */
async function callAI(prompt) {
    let lastErr = null;
    for (const makeUrl of AI_ENDPOINTS) {
        try {
            const { data } = await axios.get(makeUrl(prompt), {
                timeout: 25000,
                headers: { 'User-Agent': 'JuneXUltra/2.0' },
            });
            if (data?.status === true && data?.result) {
                return String(data.result).trim();
            }
        } catch (e) {
            lastErr = e;
        }
    }
    throw lastErr || new Error('All AI endpoints failed');
}

/** Extract plain text from any message type. */
function extractText(msg) {
    const m = msg?.message;
    if (!m) return '';
    const inner =
        m.ephemeralMessage?.message ||
        m.viewOnceMessageV2?.message ||
        m;
    return (
        inner.conversation ||
        inner.extendedTextMessage?.text ||
        inner.imageMessage?.caption ||
        inner.videoMessage?.caption ||
        inner.documentMessage?.caption ||
        inner.buttonsResponseMessage?.selectedDisplayText ||
        ''
    ).trim();
}

/** True if the message body mentions the bot's own number. */
function mentionsBot(msg, sock) {
    const botNum = (sock?.user?.id || '').split(':')[0].split('@')[0];
    if (!botNum) return false;

    // Explicit @mention in contextInfo
    const ctx = msg?.message?.extendedTextMessage?.contextInfo;
    if (ctx?.mentionedJid?.some(j => j.includes(botNum))) return true;

    // Raw text contains @botNum
    const text = extractText(msg);
    return text.includes(`@${botNum}`);
}

// ── Auto-reply — called by handler.js on every non-command message ─────────────

async function handleAutoReply(sock, msg, extra) {
    try {
        const { from, isGroup } = extra;
        if (msg.key.fromMe) return;

        // ── Rate limit per sender ───────────────────────────────────────────
        const sender = msg.key.participant || msg.key.remoteJid || from;
        const now    = Date.now();
        if (lastRequest.has(sender) && now - lastRequest.get(sender) < RATE_MS) return;

        // ── Check if chatbot is active for this context ─────────────────────
        let shouldReply = false;
        let mode        = 'off';

        if (isGroup) {
            const gs = database.getGroupSettings(from);
            mode = gs.chatbotMode || (gs.chatbot ? 'on' : 'off');

            if (mode === 'on') {
                shouldReply = true;
            } else if (mode === 'mention') {
                shouldReply = mentionsBot(msg, sock);
            }
        } else {
            // DM — global owner-controlled toggle
            const dmOn = database.getBotSetting('chatbotDm') ?? false;
            if (dmOn) shouldReply = true;
        }

        if (!shouldReply) return;

        // ── Extract text ────────────────────────────────────────────────────
        let text = extractText(msg);
        if (!text) return;

        // Strip @botNumber mention prefix so the AI gets clean input
        const botNum = (sock?.user?.id || '').split(':')[0].split('@')[0];
        if (botNum) text = text.replace(new RegExp(`@${botNum}\\s*`, 'g'), '').trim();
        if (!text) return;

        // ── Mark rate limit before the async API call ────────────────────────
        lastRequest.set(sender, now);

        // ── Typing indicator ─────────────────────────────────────────────────
        try { await sock.sendPresenceUpdate('composing', from); } catch (_) {}

        // ── Build prompt with history ────────────────────────────────────────
        const prompt = buildPrompt(from, text);

        // ── Call AI ──────────────────────────────────────────────────────────
        const reply = await callAI(prompt);

        // ── Store turn in history ────────────────────────────────────────────
        pushHistory(from, 'user', text);
        pushHistory(from, 'bot',  reply);

        // ── Send reply ───────────────────────────────────────────────────────
        await sock.sendMessage(from, { text: reply }, { quoted: msg });

    } catch (e) {
        console.error('[CHATBOT] handleAutoReply error:', e.message);
        // Fail silently — never crash the handler
    }
}

// ── Command ───────────────────────────────────────────────────────────────────

module.exports = {
    name: 'chatbot',
    aliases: ['cb', 'ai', 'bot'],
    category: 'admin',
    description: 'AI chatbot — auto-replies in groups and DMs via apis.keithsite.top',
    usage: '.chatbot on | off | pm | chat',

    async execute(sock, msg, args, extra) {
        const { from, isGroup, isOwner, isAdmin, reply, react } = extra;
        const sub = (args[0] || '').toLowerCase();
        const gs  = database.getGroupSettings(from);

        // ── Status / no args ────────────────────────────────────────────────
        if (!sub || sub === 'status') {
            if (isGroup) {
                const mode      = gs.chatbotMode || (gs.chatbot ? 'on' : 'off');
                const modeLabel = { on: '✅ ON', off: '❌ OFF' }[mode] || '❌ OFF';
                return reply(
                    `🤖 *Chatbot — Group*\n` +
                    `━━━━━━━━━━━━━━━━━━━━\n` +
                    `📌 Status: *${modeLabel}*\n\n` +
                    `*Commands (admin):*\n` +
                    `  .chatbot on  — enable (replies to all messages)\n` +
                    `  .chatbot off — silence / disable\n\n` +
                    `*Commands (owner):*\n` +
                    `  .chatbot pm / chat — toggle private chat replies`
                );
            } else {
                const chatsOn = database.getBotSetting('chatbotDm') ?? false;
                return reply(
                    `🤖 *Chatbot — Private Chats*\n` +
                    `━━━━━━━━━━━━━━━━━━━━\n` +
                    `📌 Status: *${chatsOn ? '✅ ON' : '❌ OFF'}*\n\n` +
                    `*Commands (owner):*\n` +
                    `  .chatbot pm / chat — toggle auto-reply in private chats\n` +
                    `  .chatbot off       — disable`
                );
            }
        }

        // ── ON — enable in group (reply to all messages) ─────────────────────
        if (sub === 'on') {
            if (!isGroup) return reply('ℹ️ Use *.chatbot pm* to toggle chatbot in private chats.');
            if (!isAdmin && !isOwner) return reply('❌ Only admins can change chatbot settings.');
            database.updateGroupSettings(from, { chatbot: true, chatbotMode: 'on' });
            await react('✅');
            return reply('🤖 *Chatbot ON* ✅\nBot will now auto-reply to all messages in this group.');
        }

        // ── OFF — silence / disable ───────────────────────────────────────────
        if (sub === 'off') {
            if (isGroup) {
                if (!isAdmin && !isOwner) return reply('❌ Only admins can change chatbot settings.');
                database.updateGroupSettings(from, { chatbot: false, chatbotMode: 'off' });
                await react('❌');
                return reply('🤖 *Chatbot OFF* ❌\nBot will no longer auto-reply in this group.');
            } else {
                if (!isOwner) return reply('❌ Only the bot owner can toggle chatbot in private chats.');
                database.setBotSetting('chatbotDm', false);
                await react('❌');
                return reply('🤖 *Chatbot OFF* ❌\nBot will no longer auto-reply in private chats.');
            }
        }

        // ── PM / CHAT — owner toggle for private chat auto-reply ─────────────
        if (sub === 'pm' || sub === 'chat' || sub === 'chats' || sub === 'dm') {
            if (!isOwner) return reply('❌ Only the bot owner can toggle chatbot in private chats.');
            const current = database.getBotSetting('chatbotDm') ?? false;
            const next    = !current;
            database.setBotSetting('chatbotDm', next);
            await react(next ? '✅' : '❌');
            return reply(
                next
                    ? '🤖 *Chatbot — Private Chats ON* ✅\nBot will now auto-reply to private messages.'
                    : '🤖 *Chatbot — Private Chats OFF* ❌\nBot will no longer auto-reply to private messages.'
            );
        }

        // ── CLEAR — wipe conversation history for this chat ──────────────────
        if (sub === 'clear' || sub === 'reset') {
            history.delete(from);
            await react('🗑️');
            return reply('🗑️ *Conversation history cleared.*\nThe bot will start fresh in this chat.');
        }

        return reply(
            `❓ Unknown option: *${sub}*\n\n` +
            `Usage: *.chatbot on | off | chats | clear | status*`
        );
    },

    handleAutoReply,
};
