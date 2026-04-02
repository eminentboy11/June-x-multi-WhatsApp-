const database = require('../../database');
const fs = require('fs');
const path = require('path');

const DM_CHATBOT_FILE = path.join(__dirname, '../../data/chatbot_dm.json');

function loadDmSettings() {
    try {
        if (fs.existsSync(DM_CHATBOT_FILE)) {
            return JSON.parse(fs.readFileSync(DM_CHATBOT_FILE, 'utf8'));
        }
    } catch {}
    return { enabled: false };
}

function saveDmSettings(data) {
    try {
        const dir = path.dirname(DM_CHATBOT_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(DM_CHATBOT_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('[Chatbot] Failed to save DM settings:', e.message);
    }
}

module.exports = {
    name: 'chatbot',
    aliases: ['cb', 'bot'],
    category: 'admin',
    description: 'Toggle AI chatbot for group or DM',
    usage: '.chatbot group | .chatbot dm | .chatbot',

    async execute(sock, msg, args, extra) {
        const { from, isGroup, isOwner, isAdmin, reply } = extra;
        const mode = (args[0] || '').toLowerCase();

        // No args → show current status
        if (!mode) {
            const groupEnabled = isGroup ? database.getGroupSettings(from).chatbot : null;
            const dmSettings = loadDmSettings();
            return reply(
                `🤖 *Chatbot Status*\n\n` +
                (isGroup ? `┃ 👥 Group Chatbot: ${groupEnabled ? '✅ ON' : '❌ OFF'}\n` : '') +
                `┃ 💬 DM Chatbot: ${dmSettings.enabled ? '✅ ON' : '❌ OFF'}\n\n` +
                `*Usage:*\n` +
                `• *.chatbot group* — Toggle AI replies in this group\n` +
                `• *.chatbot dm* — Toggle AI replies in DMs (owner only)\n\n` +
                `_When enabled, the bot replies to every message with AI._`
            );
        }

        if (mode === 'group' || mode === 'grp') {
            if (!isGroup) return reply('❌ Use this in a group chat.');
            if (!isAdmin && !isOwner) return reply('❌ Only group admins can toggle this.');
            const current = database.getGroupSettings(from).chatbot;
            database.updateGroupSettings(from, { chatbot: !current });
            const now = !current;
            return reply(
                `🤖 *Group Chatbot ${now ? 'Enabled ✅' : 'Disabled ❌'}*\n\n` +
                (now
                    ? `The bot will now auto-reply to every message in this group using AI.\n\n_Use *.chatbot group* again to turn it off._`
                    : `The bot will no longer auto-reply to messages in this group.`)
            );
        }

        if (mode === 'dm' || mode === 'private' || mode === 'pm') {
            if (!isOwner) return reply('❌ Only the bot owner can toggle DM chatbot.');
            const dmSettings = loadDmSettings();
            dmSettings.enabled = !dmSettings.enabled;
            saveDmSettings(dmSettings);
            const now = dmSettings.enabled;
            return reply(
                `🤖 *DM Chatbot ${now ? 'Enabled ✅' : 'Disabled ❌'}*\n\n` +
                (now
                    ? `The bot will now auto-reply to all private messages using AI.\n\n_Use *.chatbot dm* again to turn it off._`
                    : `The bot will no longer auto-reply to DMs.`)
            );
        }

        return reply(
            `❓ Unknown option: *${mode}*\n\nUsage:\n• *.chatbot group* — Toggle in this group\n• *.chatbot dm* — Toggle in DMs`
        );
    },

    // Exposed for use in handler.js
    loadDmSettings,
};
