const database = require(require('path').join(global.__CORE__, 'database'));
const fs   = require('fs');
const path = require('path');
const axios = require('axios');

const SETTINGS_FILE = path.join(__dirname, '../../data/chatbot_settings.json');

// ─────────────────────────────────────────────────────────────────────────────
// Settings — persists pm toggle. Default: PM ON.
// ─────────────────────────────────────────────────────────────────────────────

function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
            // default pmEnabled to true if not explicitly set
            if (typeof parsed.pmEnabled !== 'boolean') parsed.pmEnabled = true;
            return parsed;
        }
    } catch {}
    return { pmEnabled: true };
}

function saveSettings(data) {
    try {
        const dir = path.dirname(SETTINGS_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('[Chatbot] Failed to save settings:', e.message);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// AI API — alternates between cohere and grok
// ─────────────────────────────────────────────────────────────────────────────

async function getTextReply(prompt) {
    const useGrok = Math.random() < 0.5;
    try {
        if (useGrok) {
            const { data } = await axios.get(
                'https://apis.xcasper.space/api/ai/grok',
                { params: { query: prompt }, timeout: 60000 }
            );
            if (data?.success && data.reply) return data.reply;
            throw new Error('No reply from grok');
        } else {
            const { data } = await axios.get(
                'https://apis.xcasper.space/api/ai/cohere',
                { params: { prompt }, timeout: 60000 }
            );
            if (data?.success && data.reply) return data.reply;
            throw new Error('No reply from cohere');
        }
    } catch (primaryErr) {
        // Fallback to the other API
        try {
            if (useGrok) {
                const { data } = await axios.get(
                    'https://apis.xcasper.space/api/ai/cohere',
                    { params: { prompt }, timeout: 60000 }
                );
                if (data?.success && data.reply) return data.reply;
            } else {
                const { data } = await axios.get(
                    'https://apis.xcasper.space/api/ai/grok',
                    { params: { query: prompt }, timeout: 60000 }
                );
                if (data?.success && data.reply) return data.reply;
            }
        } catch (_) {}
        throw primaryErr;
    }
}

function getImageUrl(prompt) {
    return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&enhance=true`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-reply — called from handler.js on every non-command message
// ─────────────────────────────────────────────────────────────────────────────

async function handleAutoReply(sock, msg, extra) {
    const { from, isGroup } = extra;

    // ── Check if chatbot is active for this context ──────────────────────────
    let active = false;
    if (isGroup) {
        const gs = database.getGroupSettings(from);
        active = gs.chatbot === true;
    } else {
        const settings = loadSettings();
        active = settings.pmEnabled === true;
    }

    if (!active) return;

    // ── Extract message text ─────────────────────────────────────────────────
    const m = msg.message;
    const text = (
        m?.conversation ||
        m?.extendedTextMessage?.text ||
        m?.imageMessage?.caption ||
        m?.videoMessage?.caption ||
        ''
    ).trim();

    if (!text) return;

    // ── Show typing indicator ────────────────────────────────────────────────
    try { await sock.sendPresenceUpdate('composing', from); } catch (_) {}

    // ── Decide: image generation or text reply ───────────────────────────────
    const imageKeywords = ['generate', 'draw', 'create image', 'make image', 'image of', 'picture of', 'paint'];
    const isImageRequest = imageKeywords.some(k => text.toLowerCase().includes(k));

    try {
        if (isImageRequest) {
            const url = getImageUrl(text);
            await sock.sendMessage(from, {
                image: { url },
                caption: `🎨 *AI Image*\n\n_Prompt:_ ${text}`,
            }, { quoted: msg });
        } else {
            const reply = await getTextReply(text);
            await sock.sendMessage(from, { text: reply }, { quoted: msg });
        }
    } catch (err) {
        console.error('[Chatbot] Auto-reply error:', err.message);
        // Don't send error message to chat — fail silently
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Command
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
    name: 'chatbot',
    aliases: ['cb'],
    category: 'admin',
    description: 'Toggle AI chatbot per group or for DMs',
    usage: '.chatbot | .chatbot on | .chatbot off | .chatbot pm',

    async execute(sock, msg, args, extra) {
        const { from, isGroup, isOwner, isAdmin, reply } = extra;
        const sub = (args[0] || '').toLowerCase();
        const settings = loadSettings();

        // ── No args — show status ─────────────────────────────────────────────
        if (!sub) {
            if (isGroup) {
                const gs  = database.getGroupSettings(from);
                const on  = gs.chatbot === true;
                return reply(
                    `🤖 *Chatbot Status*\n\n` +
                    `┃ 👥 This group: ${on ? '✅ ON' : '❌ OFF'}\n\n` +
                    `*Commands (admin only):*\n` +
                    `• *.chatbot on* — Enable chatbot in this group\n` +
                    `• *.chatbot off* — Disable chatbot in this group`
                );
            } else {
                const pmOn = settings.pmEnabled;
                return reply(
                    `🤖 *Chatbot Status*\n\n` +
                    `┃ 💬 PM/DM: ${pmOn ? '✅ ON' : '❌ OFF'}\n\n` +
                    `*Commands (owner only):*\n` +
                    `• *.chatbot pm* — Toggle PM chatbot on/off`
                );
            }
        }

        // ── ON — enable for this group ────────────────────────────────────────
        if (sub === 'on') {
            if (!isGroup) return reply('ℹ️ Use *.chatbot pm* to toggle DM chatbot.');
            if (!isAdmin && !isOwner) return reply('❌ Only group admins can enable the chatbot.');
            if (database.getGroupSettings(from).chatbot === true) {
                return reply('ℹ️ Chatbot is already *ON* in this group.');
            }
            database.updateGroupSettings(from, { chatbot: true });
            return reply(
                `🤖 *Chatbot Enabled ✅*\n\n` +
                `The bot will now auto-reply to all messages in this group.\n\n` +
                `_Use *.chatbot off* to disable._`
            );
        }

        // ── OFF — disable for this group (or PM if in DM) ────────────────────
        if (sub === 'off') {
            if (isGroup) {
                if (!isAdmin && !isOwner) return reply('❌ Only group admins can disable the chatbot.');
                if (database.getGroupSettings(from).chatbot !== true) {
                    return reply('ℹ️ Chatbot is already *OFF* in this group.');
                }
                database.updateGroupSettings(from, { chatbot: false });
                return reply(
                    `🤖 *Chatbot Disabled ❌*\n\n` +
                    `The bot will no longer auto-reply in this group.\n\n` +
                    `_Use *.chatbot on* to re-enable._`
                );
            } else {
                if (!isOwner) return reply('❌ Only the bot owner can toggle PM chatbot.');
                settings.pmEnabled = false;
                saveSettings(settings);
                return reply(
                    `🤖 *PM Chatbot Disabled ❌*\n\n` +
                    `The bot will no longer auto-reply to DMs.\n\n` +
                    `_Use *.chatbot pm* to re-enable._`
                );
            }
        }

        // ── PM / DM — owner toggle for private messages ───────────────────────
        if (sub === 'pm' || sub === 'dm') {
            if (!isOwner) return reply('❌ Only the bot owner can toggle PM chatbot.');
            const newState = !settings.pmEnabled;
            settings.pmEnabled = newState;
            saveSettings(settings);
            return reply(
                newState
                    ? `🤖 *PM Chatbot Enabled ✅*\n\nThe bot will auto-reply to all private messages.\n\n_Use *.chatbot pm* again to turn off._`
                    : `🤖 *PM Chatbot Disabled ❌*\n\nThe bot will no longer auto-reply to DMs.\n\n_Use *.chatbot pm* again to turn on._`
            );
        }

        // ── Unknown subcommand ────────────────────────────────────────────────
        return reply(
            `❓ Unknown option: *${sub}*\n\n` +
            `Usage:\n` +
            `• *.chatbot* — Show status\n` +
            `• *.chatbot on* — Enable in this group\n` +
            `• *.chatbot off* — Disable in this group / DM\n` +
            `• *.chatbot pm* / *.chatbot dm* — Toggle PM chatbot (owner)`
        );
    },

    handleAutoReply,
    loadSettings,
};
