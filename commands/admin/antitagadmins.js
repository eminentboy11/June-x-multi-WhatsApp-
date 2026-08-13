'use strict';

/**
 * AntiTagAdmins
 * Prevents non-admins from tagging/mentioning group admins.
 *
 * Configuration is group-scoped and stored only in SQLite through database.js.
 */

const database = require('../../database');

const ACTION_LABELS = { kick: '👢 Kick', warn: '⚠️ Warn', delete: '🗑️ Delete' };
const VALID_ACTIONS = new Set(['kick', 'warn', 'delete']);

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
        const groupCfg = database.getAntiTagAdminsSettings(from);

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

        const first = args[0].toLowerCase();
        const requestedAction = (args[1] || 'warn').toLowerCase();

        if (first === 'off') {
            database.setAntiTagAdminsSettings(from, { enabled: false });
            return reply('🛡️ *AntiTagAdmins* turned ❌ *OFF*.');
        }

        if (first === 'on') {
            const action = VALID_ACTIONS.has(requestedAction) ? requestedAction : 'warn';
            database.setAntiTagAdminsSettings(from, { enabled: true, action });
            return reply(
                `🛡️ *AntiTagAdmins* turned ✅ *ON*\n\n` +
                `Action: *${ACTION_LABELS[action]}*\n\n` +
                `Non-admins who tag group admins will be *${action}ed*.`
            );
        }

        return reply('❌ Usage: `.antitagadmins on [kick|warn|delete]` | `.antitagadmins off`');
    },

    // Called from handler.js for every group message. The message handling
    // logic remains in-memory/runtime-only; only configuration moved to SQLite.
    async handleMessage(sock, msg, groupMetadata, sender, from, senderIsOwner = false) {
        const groupCfg = database.getAntiTagAdminsSettings(from);
        if (!groupCfg.enabled || msg.key?.fromMe) return;

        // Extract all mentioned JIDs.
        const ctx = msg.message?.extendedTextMessage?.contextInfo
                  || msg.message?.imageMessage
                  || msg.message?.videoMessage;
        const mentionedJids = ctx?.mentionedJid || [];
        if (!mentionedJids.length) return;

        const participants = groupMetadata?.participants || [];
        const adminJids = new Set(
            participants.filter(participant => participant.admin).map(participant => participant.id)
        );
        if (!adminJids.size) return;

        const taggedAdmins = mentionedJids.filter(jid => adminJids.has(jid));
        if (!taggedAdmins.length) return;

        // Admins and configured owners may tag admins; this feature applies to
        // non-admin members only.
        const senderIsAdmin = participants.some(
            participant => participant.id === sender && participant.admin
        );
        if (senderIsAdmin || senderIsOwner) return;

        const action = groupCfg.action;
        const adminTags = taggedAdmins.map(jid => `@${jid.split('@')[0]}`).join(', ');

        try {
            // Delete first for every supported action. A failed delete should not
            // prevent a warning/kick attempt when the bot has the permission.
            try { await sock.sendMessage(from, { delete: msg.key }); } catch (_) {}

            if (action === 'warn') {
                await sock.sendMessage(from, {
                    text: `🛡️ *AntiTagAdmins*\n\n⚠️ @${sender.split('@')[0]}, you are *not allowed* to tag admins (${adminTags}).\nFurther violations may result in a kick.`,
                    mentions: [sender, ...taggedAdmins],
                }, { quoted: msg });
            }

            if (action === 'kick') {
                try { await sock.groupParticipantsUpdate(from, [sender], 'remove'); } catch (_) {}
                await sock.sendMessage(from, {
                    text: `🛡️ *AntiTagAdmins*\n\n👢 @${sender.split('@')[0]} was kicked for tagging admins (${adminTags}).`,
                    mentions: [sender, ...taggedAdmins],
                });
            }
            // action === 'delete' has already been handled above.
        } catch (error) {
            console.error('[ANTITAGADMINS] error:', error.message);
        }
    },
};
