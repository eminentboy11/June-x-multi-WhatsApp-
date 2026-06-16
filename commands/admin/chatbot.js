const database = require(require('path').join(global.__CORE__, 'database'));
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const SETTINGS_FILE = path.join(__dirname, '../../data/chatbot_settings.json');

// ── API helpers ───────────────────────────────────────────────────────────────

const getTextReply = async (prompt) => {
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
    return { pmEnabled: false, gcEnabled: false };
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

// ── Auto-reply handler (called from handler.js) ───────────────────────────────

async function handleAutoReply(sock, msg, extra) {
    const { from, isGroup } = extra;
    const settings = loadSettings();

    const active = isGroup
        ? (settings.gcEnabled === true || database.getGroupSettings(from).chatbot === true)
        : settings.pmEnabled === true;

    if (!active) return;

    const text = msg.message?.conversation
        || msg.message?.extendedTextMessage?.text
        || '';

    if (!text.trim()) return;

    try {
        await sock.sendPresenceUpdate('composing', from);
    } catch (_) {}

    try {
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
    description: 'Toggle AI chatbot for PM or group chats',
    usage: '.chatbot | .chatbot pm/dm | .chatbot group/gc | .chatbot off',

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
                (isGroup ? `┃ 👥 This group: ${groupOn ? '✅ ON' : '❌ OFF'}\n` : '') +
                `┃ 💬 PM/DM: ${pmOn ? '✅ ON' : '❌ OFF'}\n` +
                `┃ 👥 All GCs: ${gcOn ? '✅ ON' : '❌ OFF'}\n\n` +
                `*Commands:*\n` +
                `• *.chatbot pm* or *.chatbot dm* — Toggle PM chatbot\n` +
                `• *.chatbot group* or *.chatbot gc* — Toggle all-group chatbot\n` +
                `• *.chatbot off* — Turn OFF both PM and GC chatbot`
            );
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
            if (!isOwner) return reply('❌ Only the bot owner can toggle the group chatbot.');
            const newState = !settings.gcEnabled;
            settings.gcEnabled = newState;
            saveSettings(settings);
            return reply(
                newState
                    ? `🤖 *Group Chatbot Enabled ✅*\n\nThe bot will now auto-reply to messages in ALL groups.\n\n_Use *.chatbot group* again to turn off._`
                    : `🤖 *Group Chatbot Disabled ❌*\n\nThe bot will no longer auto-reply in all groups.\n\n_Use *.chatbot group* again to turn on._`
            );
        }

        // ── OFF — kills both PM and GC ───────────────────────────────────────
        if (mode === 'off') {
            if (!isOwner && !isAdmin) return reply('❌ Only the bot owner or group admin can use this.');
            settings.pmEnabled = false;
            settings.gcEnabled = false;
            saveSettings(settings);
            return reply(
                `🤖 *Chatbot Disabled ❌*\n\n` +
                `Both PM and Group chatbot have been turned off.\n\n` +
                `_Use *.chatbot pm* or *.chatbot group* to turn on individually._`
            );
        }

        // ── Unknown ──────────────────────────────────────────────────────────
        return reply(
            `❓ Unknown option: *${mode}*\n\n` +
            `Usage:\n` +
            `• *.chatbot* — Show status\n` +
            `• *.chatbot pm* / *.chatbot dm* — Toggle PM chatbot\n` +
            `• *.chatbot group* / *.chatbot gc* — Toggle all-group chatbot\n` +
            `• *.chatbot off* — Turn off both PM and GC chatbot`
        );
    },

    handleAutoReply,
    loadSettings,
};
