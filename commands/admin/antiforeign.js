/**
 * AntiForeign Command
 * Auto-kicks members whose phone number country code doesn't match the allowed code.
 *
 * Usage:
 *   .antiforeign                  — show status
 *   .antiforeign <code> on        — enable (e.g. .antiforeign 254 on)
 *   .antiforeign off              — disable
 *   .antiforeign kick             — immediately kick all foreign numbers now
 */

const fs   = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '../../data/antiforeign.json');

function loadConfig() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) fs.writeFileSync(CONFIG_PATH, '{}');
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch { return {}; }
}

function saveConfig(cfg) {
    try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2)); } catch {}
}

function normaliseCode(raw) {
    return raw.replace(/^\+/, '').trim();
}

function isForeign(jid, allowedCode) {
    const phone = jid.split('@')[0].split(':')[0];
    return !phone.startsWith(allowedCode);
}

module.exports = {
    name: 'antiforeign',
    aliases: ['antiforeign', 'foreignprotect', 'antiforeigners'],
    category: 'admin',
    description: 'Auto-kick members whose number does not match the allowed country code',
    usage: '.antiforeign <code> on | .antiforeign off | .antiforeign kick',
    groupOnly: true,
    adminOnly: true,
    botAdminNeeded: true,

    async execute(sock, msg, args, extra) {
        const { from, reply } = extra;
        const cfg       = loadConfig();
        const groupCfg  = cfg[from] || { enabled: false, code: null };

        const statusText = () =>
            groupCfg.enabled
                ? `✅ ON  (allowed code: *+${groupCfg.code}*)`
                : '❌ OFF';

        // No args — show status
        if (!args.length) {
            return reply(
                `🌍 *AntiForegn*\n\n` +
                `Status: ${statusText()}\n\n` +
                `*Commands:*\n` +
                `• \`.antiforeign 254 on\` — only allow +254 numbers\n` +
                `• \`.antiforeign +92 on\` — only allow +92 numbers\n` +
                `• \`.antiforeign off\` — disable\n` +
                `• \`.antiforeign kick\` — kick all foreign numbers now`
            );
        }

        const first  = args[0].toLowerCase();
        const second = (args[1] || '').toLowerCase();

        // .antiforeign off
        if (first === 'off') {
            groupCfg.enabled = false;
            cfg[from] = groupCfg;
            saveConfig(cfg);
            return reply('🌍 *AntiForegn* turned ❌ *OFF*.');
        }

        // .antiforeign kick — manual purge
        if (first === 'kick' || first === 'run' || first === 'purge') {
            if (!groupCfg.enabled || !groupCfg.code) {
                return reply('❌ AntiForegn is not enabled. Set it first:\n*.antiforeign 254 on*');
            }
            return this._kickForeigners(sock, from, groupCfg.code, reply);
        }

        // .antiforeign <code> on
        const code = normaliseCode(first);
        if (!/^\d+$/.test(code)) {
            return reply('❌ Invalid country code. Example: *.antiforeign 254 on*');
        }

        if (second === 'on' || second === '') {
            groupCfg.enabled = true;
            groupCfg.code    = code;
            cfg[from] = groupCfg;
            saveConfig(cfg);
            return reply(
                `🌍 *AntiForegn* turned ✅ *ON*\n\n` +
                `Allowed country code: *+${code}*\n` +
                `Members who join without *+${code}* will be auto-kicked.\n\n` +
                `Run *.antiforeign kick* to purge existing foreign numbers.`
            );
        }

        if (second === 'off') {
            groupCfg.enabled = false;
            cfg[from] = groupCfg;
            saveConfig(cfg);
            return reply('🌍 *AntiForegn* turned ❌ *OFF*.');
        }

        return reply('❌ Unknown option.\n\nUsage: `.antiforeign 254 on` | `.antiforeign off` | `.antiforeign kick`');
    },

    // Called on every group join from handler.js
    async handleGroupJoin(sock, groupJid, participantJid) {
        const cfg      = loadConfig();
        const groupCfg = cfg[groupJid];
        if (!groupCfg?.enabled || !groupCfg.code) return;

        if (isForeign(participantJid, groupCfg.code)) {
            try {
                await sock.groupParticipantsUpdate(groupJid, [participantJid], 'remove');
                await sock.sendMessage(groupJid, {
                    text: `🌍 *AntiForegn:* Removed @${participantJid.split('@')[0]} — number does not match allowed code *+${groupCfg.code}*.`,
                    mentions: [participantJid],
                });
            } catch (e) {
                console.error('[ANTIFOREIGN] kick error:', e.message);
            }
        }
    },

    // Manual purge helper
    async _kickForeigners(sock, groupJid, code, reply) {
        try {
            const meta    = await sock.groupMetadata(groupJid);
            const botJid  = sock.user?.id || '';
            const botPhone = botJid.split('@')[0].split(':')[0];

            const toKick = (meta.participants || []).filter(p => {
                const phone = p.id.split('@')[0].split(':')[0];
                if (phone === botPhone) return false;          // never kick self
                if (p.admin) return false;                     // never kick admins
                return !phone.startsWith(code);
            });

            if (!toKick.length) {
                return reply(`✅ No foreign numbers found (allowed: +${code}).`);
            }

            await reply(`⏳ Kicking *${toKick.length}* foreign member(s) with code other than *+${code}*...`);

            const jids = toKick.map(p => p.id);
            await sock.groupParticipantsUpdate(groupJid, jids, 'remove');

            await sock.sendMessage(groupJid, {
                text: `🌍 *AntiForegn:* Kicked *${toKick.length}* member(s) whose numbers don't match *+${code}*.`,
            });
        } catch (e) {
            console.error('[ANTIFOREIGN] purge error:', e.message);
            await reply(`❌ Error during purge: ${e.message}`);
        }
    },
};
