/**
 * AntiTagAdmins Command
 * Prevents non-admins from tagging/mentioning group admins.
 *
 * Usage:
 *   .antitagadmins              — show current status
 *   .antitagadmins on           — enable (default action: warn)
 *   .antitagadmins on kick      — enable with kick action
 *   .antitagadmins on warn      — enable with warn action
 *   .antitagadmins on delete    — enable with delete action
 *   .antitagadmins off          — disable
 */

const fs   = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '../../data/antitagadmins.json');

function loadConfig() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) fs.writeFileSync(CONFIG_PATH, '{}');
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch { return {}; }
}

function saveConfig(cfg) {
    try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2)); } catch {}
}

const ACTION_LABELS = { kick: '👢 Kick', warn: '⚠️ Warn', delete: '🗑️ Delete' };

module.exports = {
    name: 'antitagadmins',
    aliases: ['antiadmintag', 'antitagadmin', 'notagadmin'],
    category: 'admin',
    description: 'Prevent non-admins from tagging group admins',
    usage: '.antitagadmins on [kick|warn|delete] | .antitagadmins off',
    groupOnly: true,
    adminOnly: true,
    botAdminNeeded: true,

    async execute(sock, msg, args, extra) {
        const { from, reply } = extra;
        const cfg      = loadConfig();
        const groupCfg = cfg[from] || { enabled: false, action: 'warn' };

        const statusLine = groupCfg.enabled
            ? `✅ *ON* — action: *${ACTION_LABELS[groupCfg.action] || groupCfg.action}*`
            : '❌ *OFF*';

        if (!args.length) {
            return reply(
                `🛡️ *AntiTagAdmins*\n\n` +
                `Status: ${statusLine}\n\n` +
                `*Commands:*\n` +
                `• \`.antitagadmins on\` — enable (default: warn)\n` +
                `• \`.antitagadmins on kick\` — kick the offender\n` +
                `• \`.antitagadmins on warn\` — warn + delete message\n` +
                `• \`.antitagadmins on delete\` — silently delete message\n` +
                `• \`.antitagadmins off\` — disable`
            );
        }

        const first  = args[0].toLowerCase();
        const second = (args[1] || 'warn').toLowerCase();

        if (first === 'off') {
            groupCfg.enabled = false;
            cfg[from] = groupCfg;
            saveConfig(cfg);
            return reply('🛡️ *AntiTagAdmins* turned ❌ *OFF*.');
        }

        if (first === 'on') {
            const validActions = ['kick', 'warn', 'delete'];
            const action = validActions.includes(second) ? second : 'warn';
            groupCfg.enabled = true;
            groupCfg.action  = action;
            cfg[from] = groupCfg;
            saveConfig(cfg);
            return reply(
                `🛡️ *AntiTagAdmins* turned ✅ *ON*\n\n` +
                `Action: *${ACTION_LABELS[action]}*\n\n` +
                `Non-admins who tag group admins will be *${action}ed*.`
            );
        }

        return reply('❌ Usage: `.antitagadmins on [kick|warn|delete]` | `.antitagadmins off`');
    },

    // ── Called from handler.js on every group message ────────────────────────
    async handleMessage(sock, msg, groupMetadata, sender, from) {
        const cfg      = loadConfig();
        const groupCfg = cfg[from];
        if (!groupCfg?.enabled) return;

        // Extract all mentioned JIDs
        const ctx = msg.message?.extendedTextMessage?.contextInfo
                  || msg.message?.imageMessage
                  || msg.message?.videoMessage;
        const mentionedJids = ctx?.mentionedJid || [];
        if (!mentionedJids.length) return;

        // Build admin JID set for this group
        const participants = groupMetadata?.participants || [];
        const adminJids    = new Set(
            participants.filter(p => p.admin).map(p => p.id)
        );
        if (!adminJids.size) return;

        // Does this message tag any admin?
        const taggedAdmins = mentionedJids.filter(jid => adminJids.has(jid));
        if (!taggedAdmins.length) return;

        // Is the sender themselves an admin or owner? Skip if so.
        const senderIsAdmin = participants.some(
            p => p.id === sender && p.admin
        );
        if (senderIsAdmin) return;

        const action = groupCfg.action || 'warn';
        const adminTags = taggedAdmins.map(j => `@${j.split('@')[0]}`).join(', ');

        try {
            if (action === 'delete' || action === 'warn' || action === 'kick') {
                // Always delete the offending message first
                try { await sock.sendMessage(from, { delete: msg.key }); } catch (_) {}
            }

            if (action === 'warn') {
                await sock.sendMessage(from, {
                    text: `🛡️ *AntiTagAdmins*\n\n⚠️ @${sender.split('@')[0]}, you are *not allowed* to tag admins (${adminTags}).\nFurther violations may result in a kick.`,
                    mentions: [sender, ...taggedAdmins],
                }, { quoted: msg });
            }

            if (action === 'kick') {
                try {
                    await sock.groupParticipantsUpdate(from, [sender], 'remove');
                } catch (_) {}
                await sock.sendMessage(from, {
                    text: `🛡️ *AntiTagAdmins*\n\n👢 @${sender.split('@')[0]} was kicked for tagging admins (${adminTags}).`,
                    mentions: [sender, ...taggedAdmins],
                });
            }
            // action === 'delete' → already deleted above, no extra notice

        } catch (err) {
            console.error('[ANTITAGADMINS] error:', err.message);
        }
    },
};
