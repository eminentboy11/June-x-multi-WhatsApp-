const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '../../data/antibot.json');

const BOT_PATTERNS = [/bot/i, /\bai\b/i, /assistant/i, /automate/i, /robot/i, /script/i, /spam/i, /flood/i];

// Names/patterns that should NEVER be kicked (own bot identity)
const WHITELIST_PATTERNS = [/junex/i, /june[\s\-_]?x/i, /june[\s\-_]?ultra/i, /juneultra/i];

const loadConfig = () => {
    try {
        if (!fs.existsSync(CONFIG_PATH)) fs.writeFileSync(CONFIG_PATH, '{}');
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch { return {}; }
};

const saveConfig = (cfg) => {
    try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2)); } catch {}
};

const isWhitelisted = (name) => name && WHITELIST_PATTERNS.some(p => p.test(name));
const isSuspectedBot = (name) => name && !isWhitelisted(name) && BOT_PATTERNS.some(p => p.test(name));

function getBotJid(sock) {
    const id = sock?.user?.id;
    if (!id) return null;
    return id.includes(':') ? id.split(':')[0] + '@s.whatsapp.net' : id;
}

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

        // Never kick the bot itself
        const selfJid = getBotJid(sock);
        if (selfJid && participant === selfJid) return;

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
            console.error('[ANTIBOT] handleGroupJoin error:', e.message);
        }
    },

    async handleMessage(sock, msg, groupMetadata) {
        if (!msg || !groupMetadata) return;

        const from = msg.key.remoteJid;
        if (!from?.endsWith('@g.us')) return;

        const cfg = loadConfig();
        if (!cfg[from]?.enabled) return;

        // Only act on extendedTextMessage
        const m = msg.message;
        if (!m?.extendedTextMessage) return;

        // Skip bot's own messages
        if (msg.key.fromMe) return;

        const sender = msg.key.participant || msg.key.remoteJid;
        if (!sender) return;

        // Never kick the bot itself
        const selfJid = getBotJid(sock);
        if (selfJid && sender === selfJid) return;

        // Don't kick admins
        const admins = (groupMetadata?.participants || [])
            .filter(p => p.admin === 'admin' || p.admin === 'superadmin')
            .map(p => p.id);
        if (admins.includes(sender)) return;

        // Collect all available name signals for this sender
        const jidName  = sender.split('@')[0];
        const pushName = msg.pushName || '';
        const ext      = m.extendedTextMessage;

        const namesToCheck = [jidName, pushName];

        // extendedTextMessage may carry a forwarding context with a participant name
        const fwdSender = ext?.contextInfo?.participant?.split('@')[0] || '';
        if (fwdSender) namesToCheck.push(fwdSender);

        const detected = namesToCheck.some(n => isSuspectedBot(n));
        if (!detected) return;

        try {
            await sock.groupParticipantsUpdate(from, [sender], 'remove');
            await sock.sendMessage(from, {
                text: `🤖 *AntiBot:* Kicked suspected bot *@${sender.split('@')[0]}* (detected via message)`,
                mentions: [sender]
            });
        } catch (e) {
            console.error('[ANTIBOT] handleMessage kick error:', e.message);
        }
    }
};
