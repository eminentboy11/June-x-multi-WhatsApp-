const database = require('../../database');
const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, '../../data/chatbot_settings.json');

const AGENTS = {
    keith:      { label: 'Keith AI',              emoji: '🤖', type: 'text',      endpoint: '/keithai' },
    gpt:        { label: 'GPT-4',                 emoji: '💡', type: 'text',      endpoint: '/ai/gpt4' },
    gemini:     { label: 'Gemini',                emoji: '✨', type: 'text',      endpoint: '/ai/gemini' },
    claude:     { label: 'Claude',                emoji: '🧠', type: 'text',      endpoint: '/ai/claudeai' },
    deepseek:   { label: 'DeepSeek R1',           emoji: '🔍', type: 'text',      endpoint: '/ai/deepseek' },
    grok:       { label: 'Grok (xAI)',            emoji: '⚡', type: 'text',      endpoint: '/ai/grok' },
    meta:       { label: 'Meta AI (LLaMA)',        emoji: '🦙', type: 'text',      endpoint: '/ai/metai' },
    mistral:    { label: 'Mistral',               emoji: '🌀', type: 'text',      endpoint: '/ai/mistral' },
    perplexity: { label: 'Perplexity',            emoji: '🔮', type: 'text',      endpoint: '/ai/perplexity' },
    vision:     { label: 'Vision (Gemini Image)', emoji: '👁️',  type: 'vision',    endpoint: null },
    meme:       { label: 'Meme (random)',          emoji: '😂', type: 'meme',      endpoint: null },
    memesearch: { label: 'Meme Search',            emoji: '🔎', type: 'memesearch', endpoint: null },
    all:        { label: 'All Agents (smart)',     emoji: '🌐', type: 'all',       endpoint: null },
};

function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
        }
    } catch {}
    return { enabled: false, agent: 'keith' };
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

function loadDmSettings() {
    return loadSettings();
}

module.exports = {
    name: 'chatbot',
    aliases: ['cb', 'bot'],
    category: 'admin',
    description: 'Toggle AI chatbot for group or PM, and choose the AI agent',
    usage: '.chatbot | .chatbot pm | .chatbot group | .chatbot agent <name>',

    async execute(sock, msg, args, extra) {
        const { from, isGroup, isOwner, isAdmin, reply } = extra;
        const mode = (args[0] || '').toLowerCase();
        const sub  = (args[1] || '').toLowerCase();

        const settings     = loadSettings();
        const groupEnabled = isGroup ? database.getGroupSettings(from).chatbot : null;
        const agentKey     = settings.agent || 'keith';
        const currentAgent = AGENTS[agentKey] || AGENTS.keith;

        if (!mode) {
            const agentList = Object.entries(AGENTS)
                .map(([k, v]) => `  ${agentKey === k ? '▶' : '•'} ${v.emoji} *${k}* — ${v.label}`)
                .join('\n');

            return reply(
                `🤖 *Chatbot Status*\n\n` +
                (isGroup ? `┃ 👥 Group: ${groupEnabled ? '✅ ON' : '❌ OFF'}\n` : '') +
                `┃ 💬 PM: ${settings.enabled ? '✅ ON' : '❌ OFF'}\n` +
                `┃ 🎯 Agent: ${currentAgent.emoji} *${agentKey}* — ${currentAgent.label}\n\n` +
                `*Commands:*\n` +
                `• *.chatbot group* — Toggle AI replies in this group\n` +
                `• *.chatbot pm* — Toggle AI replies in DMs (owner only)\n` +
                `• *.chatbot agent <name>* — Switch AI agent\n\n` +
                `*Available Agents:*\n${agentList}`
            );
        }

        if (mode === 'group' || mode === 'grp') {
            if (!isGroup) return reply('❌ Use this command inside a group chat.');
            if (!isAdmin && !isOwner) return reply('❌ Only group admins can toggle the chatbot.');
            const current = database.getGroupSettings(from).chatbot;
            database.updateGroupSettings(from, { chatbot: !current });
            const now = !current;
            return reply(
                `🤖 *Group Chatbot ${now ? 'Enabled ✅' : 'Disabled ❌'}*\n\n` +
                (now
                    ? `The bot will now auto-reply to every message in this group using ${currentAgent.emoji} *${currentAgent.label}*.\n\n_Use *.chatbot group* again to turn off._`
                    : `The bot will no longer auto-reply to messages in this group.`)
            );
        }

        if (mode === 'pm' || mode === 'dm' || mode === 'private') {
            if (!isOwner) return reply('❌ Only the bot owner can toggle PM chatbot.');
            settings.enabled = !settings.enabled;
            saveSettings(settings);
            const now = settings.enabled;
            return reply(
                `🤖 *PM Chatbot ${now ? 'Enabled ✅' : 'Disabled ❌'}*\n\n` +
                (now
                    ? `The bot will now auto-reply to all private messages using ${currentAgent.emoji} *${currentAgent.label}*.\n\n_Use *.chatbot pm* again to turn off._`
                    : `The bot will no longer auto-reply to DMs.`)
            );
        }

        if (mode === 'agent' || mode === 'ai' || mode === 'set') {
            if (!sub) {
                const agentList = Object.entries(AGENTS)
                    .map(([k, v]) => `  ${agentKey === k ? '▶' : '•'} ${v.emoji} *${k}* — ${v.label}`)
                    .join('\n');
                return reply(
                    `🎯 *Available AI Agents*\n\n${agentList}\n\n` +
                    `Usage: *.chatbot agent <name>*\nExample: *.chatbot agent gpt*`
                );
            }

            if (!AGENTS[sub]) {
                return reply(
                    `❌ Unknown agent: *${sub}*\n\n` +
                    `Available: ${Object.keys(AGENTS).join(', ')}`
                );
            }

            if (!isOwner && !isAdmin) return reply('❌ Only admins or the bot owner can change the AI agent.');
            settings.agent = sub;
            saveSettings(settings);
            const chosen = AGENTS[sub];
            return reply(
                `✅ *AI Agent Changed*\n\n` +
                `${chosen.emoji} *${chosen.label}* is now the active chatbot agent.\n\n` +
                `All auto-replies will use this model.`
            );
        }

        return reply(
            `❓ Unknown option: *${mode}*\n\n` +
            `Usage:\n` +
            `• *.chatbot* — Show full status\n` +
            `• *.chatbot group* — Toggle in groups\n` +
            `• *.chatbot pm* — Toggle in DMs\n` +
            `• *.chatbot agent <name>* — Switch AI agent`
        );
    },

    loadDmSettings,
    loadSettings,
    AGENTS,
};
