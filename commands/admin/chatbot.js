const database = require(require('path').join(global.__CORE__, 'database'));
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const SETTINGS_FILE = path.join(__dirname, '../../data/chatbot_settings.json');

// ── API helpers ───────────────────────────────────────────────────────────────

const getTextReply = async (prompt) => {
    // alternates between cohere and grok on each call
    const useGrok = Math.random() < 0.5;
    if (useGrok) {
        const { data } = await axios.get('https://apis.xcasper.space/api/ai/grok', { params: { query: prompt }, timeout: 60000 });
        if (!data?.success || !data.reply) throw new Error('No reply from grok');
        return data.reply;
    } else {
        const { data } = await axios.get('https://apis.xcasper.space/api/ai/cohere', { params: { prompt }, timeout: 60000 });
        if (!data?.success || !data.reply) throw new Error('No reply from cohere');
        return data.reply;
    }
};

const getImageUrl = (prompt) =>
    `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&enhance=true`;

// ── Settings helpers ──────────────────────────────────────────────────────────

function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
        }
    } catch {}
    return { pmEnabled: false };
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

// ── Auto-reply handler (called from message listener) ─────────────────────────

async function handleAutoReply(sock, msg, extra) {
    const { from, isGroup } = extra;
    const settings = loadSettings();

    // check if chatbot is on for this context
    const active = isGroup
        ? database.getGroupSettings(from).chatbot
        : settings.pmEnabled;

    if (!active) return;

    const text = msg.message?.conversation
        || msg.message?.extendedTextMessage?.text
        || '';

    if (!text.trim()) return;

    try {
        // if message looks like an image request, send image
        const imageKeywords = ['generate', 'draw', 'create image', 'make image', 'image of', 'picture of'];
        const isImageRequest = imageKeywords.some(k => text.toLowerCase().includes(k));

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
    }
}

// ── Command ───────────────────────────────────────────────────────────────────

module.exports = {
    name: 'chatbot',
    aliases: ['cb', 'bot'],
    category: 'admin',
    description: 'Toggle AI chatbot on/off for group or PM',
    usage: '.chatbot on/off | .chatbot pm/dm | .chatbot group/gc',

    async execute(sock, msg, args, extra) {
        const { from, isGroup, isOwner, isAdmin, reply } = extra;
        const mode = (args[0] || '').toLowerCase();
        const settings = loadSettings();

        // ── Status (no args) ─────────────────────────────────────────────────
        if (!mode) {
            const groupOn = isGroup ? database.getGroupSettings(from).chatbot : null;
            const pmOn    = settings.pmEnabled;
            const gcOn    = settings.gcEnabled;
            return reply(
                `🤖 *Chatbot Status*\n\n` +
                (isGroup ? `┃ 👥 Group (this chat): ${groupOn ? '✅ ON' : '❌ OFF'}\n` : '') +
                `┃ 💬 PM/DM (all private): ${pmOn ? '✅ ON' : '❌ OFF'}\n` +
                `┃ 👥 GC/Group (all groups): ${gcOn ? '✅ ON' : '❌ OFF'}\n\n` +
                `*Commands:*\n` +
                `• *.chatbot on* — Turn on chatbot here\n` +
                `• *.chatbot off* — Turn off chatbot here\n` +
                `• *.chatbot pm* or *.chatbot dm* — Toggle PM chatbot\n` +
                `• *.chatbot group* or *.chatbot gc* — Toggle all-group chatbot`
            );
        }

        // ── ON (context-aware) ───────────────────────────────────────────────
        if (mode === 'on') {
            if (isGroup) {
                if (!isAdmin && !isOwner) return reply('❌ Only group admins can toggle the chatbot.');
                const current = database.getGroupSettings(from).chatbot;
                if (current) return reply('ℹ️ Chatbot is already *ON* in this group.');
                database.updateGroupSettings(from, { chatbot: true });
                return reply(
                    `🤖 *Group Chatbot Enabled ✅*\n\n` +
                    `The bot will now auto-reply to every message in this group.\n\n` +
                    `_Use *.chatbot off* to turn off._`
                );
            } else {
                if (!isOwner) return reply('❌ Only the bot owner can toggle PM chatbot.');
                if (settings.pmEnabled) return reply('ℹ️ Chatbot is already *ON* in PM.');
                settings.pmEnabled = true;
                saveSettings(settings);
                return reply(
                    `🤖 *PM Chatbot Enabled ✅*\n\n` +
                    `The bot will now auto-reply to all private messages.\n\n` +
                    `_Use *.chatbot off* to turn off._`
                );
            }
        }

        // ── OFF (context-aware) ──────────────────────────────────────────────
        if (mode === 'off') {
            if (isGroup) {
                if (!isAdmin && !isOwner) return reply('❌ Only group admins can toggle the chatbot.');
                const current = database.getGroupSettings(from).chatbot;
                if (!current) return reply('ℹ️ Chatbot is already *OFF* in this group.');
                database.updateGroupSettings(from, { chatbot: false });
                return reply(
                    `🤖 *Group Chatbot Disabled ❌*\n\n` +
                    `The bot will no longer auto-reply to messages in this group.`
                );
            } else {
                if (!isOwner) return reply('❌ Only the bot owner can toggle PM chatbot.');
                if (!settings.pmEnabled) return reply('ℹ️ Chatbot is already *OFF* in PM.');
                settings.pmEnabled = false;
                saveSettings(settings);
                return reply(
                    `🤖 *PM Chatbot Disabled ❌*\n\n` +
                    `The bot will no longer auto-reply to DMs.`
                );
            }
        }

        // ── PM / DM toggle ───────────────────────────────────────────────────
        if (mode === 'pm' || mode === 'dm') {
            if (!isOwner) return reply('❌ Only the bot owner can toggle PM chatbot.');
            const newState = !settings.pmEnabled;
            settings.pmEnabled = newState;
            saveSettings(settings);
            return reply(
                newState
                    ? `🤖 *PM/DM Chatbot Enabled ✅*\n\nThe bot will now auto-reply to all private messages.\n\n_Use *.chatbot pm* again to turn off._`
                    : `🤖 *PM/DM Chatbot Disabled ❌*\n\nThe bot will no longer auto-reply to DMs.\n\n_Use *.chatbot pm* again to turn on._`
            );
        }

        // ── GROUP / GC toggle (all groups globally) ──────────────────────────
        if (mode === 'group' || mode === 'gc') {
            if (!isOwner) return reply('❌ Only the bot owner can toggle the global group chatbot.');
            const newState = !settings.gcEnabled;
            settings.gcEnabled = newState;
            saveSettings(settings);
            return reply(
                newState
                    ? `🤖 *Group Chatbot Enabled ✅*\n\nThe bot will now auto-reply to messages in ALL groups.\n\n_Use *.chatbot group* again to turn off._`
                    : `🤖 *Group Chatbot Disabled ❌*\n\nThe bot will no longer auto-reply in all groups.\n\n_Use *.chatbot group* again to turn on._`
            );
        }

        // ── Unknown ──────────────────────────────────────────────────────────
        return reply(
            `❓ Unknown option: *${mode}*\n\n` +
            `Usage:\n` +
            `• *.chatbot* — Show status\n` +
            `• *.chatbot on* — Turn on chatbot here\n` +
            `• *.chatbot off* — Turn off chatbot here\n` +
            `• *.chatbot pm* / *.chatbot dm* — Toggle PM chatbot\n` +
            `• *.chatbot group* / *.chatbot gc* — Toggle all-group chatbot`
        );
    },

    handleAutoReply,
    loadSettings,
};
