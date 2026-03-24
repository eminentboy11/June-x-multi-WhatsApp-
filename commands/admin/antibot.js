const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '../../data/antibot.json');

const BOT_PATTERNS = [/bot/i, /\bai\b/i, /assistant/i, /automate/i, /robot/i];

const loadConfig = () => {
    try {
        if (!fs.existsSync(CONFIG_PATH)) fs.writeFileSync(CONFIG_PATH, '{}');
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch { return {}; }
};

const saveConfig = (cfg) => {
    try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2)); } catch {}
};

const isSuspectedBot = (name) => name && BOT_PATTERNS.some(p => p.test(name));

module.exports = {
    name: 'antibot',
    aliases: [],
    category: 'admin',
    description: 'Toggle antibot — auto-kicks suspected bot accounts from the group',
    usage: '.antibot on/off',
    groupOnly: true,
    adminOnly: true,
    botAdminNeeded: true,

    async execute(sock, msg, args, extra) {
        const { from, reply } = extra;

        const sub = (args[0] || '').toLowerCase();
        const cfg = loadConfig();
        const groupCfg = cfg[from] || { enabled: false };

        if (!sub || !['on', 'off', 'status'].includes(sub)) {
            const status = groupCfg.enabled ? '✅ ON' : '❌ OFF';
            return reply(`🤖 *AntiBot*\n\nStatus: ${status}\n\nUsage:\n• *.antibot on* — enable\n• *.antibot off* — disable`);
        }

        if (sub === 'status') {
            return reply(`🤖 *AntiBot* is currently ${groupCfg.enabled ? '✅ ON' : '❌ OFF'}`);
        }

        groupCfg.enabled = sub === 'on';
        cfg[from] = groupCfg;
        saveConfig(cfg);

        await reply(`🤖 *AntiBot* has been turned ${groupCfg.enabled ? '✅ ON' : '❌ OFF'}.\n\n${groupCfg.enabled ? 'Suspected bot accounts will be automatically kicked.' : 'Bot detection is now disabled.'}`);
    },

    async handleGroupJoin(sock, from, participant) {
        const cfg = loadConfig();
        if (!cfg[from]?.enabled) return;

        try {
            let name = participant.split('@')[0];
            try {
                const status = await sock.fetchStatus(participant);
                name = status?.status || name;
            } catch {}

            if (isSuspectedBot(name)) {
                await sock.groupParticipantsUpdate(from, [participant], 'remove');
                await sock.sendMessage(from, {
                    text: `🤖 *AntiBot:* Kicked suspected bot *@${participant.split('@')[0]}*`,
                    mentions: [participant]
                });
            }
        } catch (e) {
            console.error('[ANTIBOT] Error:', e.message);
        }
    }
};
