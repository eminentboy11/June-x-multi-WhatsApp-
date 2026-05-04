/**
 * AntiKickAll — Protects the group from destruction commands.
 *
 * Blocked commands (when enabled): kickall · removeall · killgc · killgroup · killall
 *
 * Punishment on attempt (non-owner):
 *   1. Delete their message
 *   2. Demote them (if admin)
 *   3. Issue a warning
 *   4. Kick them from the group
 *
 * Config stored per-group in the database: antikickall (bool)
 */

const database = require(require('path').join(global.__CORE__, 'database'));

const BLOCKED_CMDS = new Set(['kickall', 'removeall', 'killgc', 'killgroup', 'killall']);

module.exports = {
    name: 'antikickall',
    aliases: ['antikick', 'protectgroup', 'groupprotect'],
    category: 'admin',
    description: 'Block anyone from running group-destruction commands (kickall, removeall, killgroup…)',
    usage: '.antikickall on | off | status',
    groupOnly: true,
    adminOnly: true,
    botAdminNeeded: true,

    BLOCKED_CMDS,

    async execute(sock, msg, args, extra) {
        const { from, reply } = extra;
        const gs  = database.getGroupSettings(from);
        const sub = (args[0] || '').toLowerCase();

        const blockedList = [...BLOCKED_CMDS].map(c => `  • .${c}`).join('\n');

        if (!sub || sub === 'status') {
            return reply(
                `🛡️ *Anti-KickAll Protection*\n` +
                `━━━━━━━━━━━━━━━\n` +
                `📌 Status: *${gs.antikickall ? '✅ ON' : '❌ OFF'}*\n\n` +
                `*Blocked commands:*\n${blockedList}\n\n` +
                `*Punishment on attempt:*\n` +
                `  🗑️ Message deleted\n` +
                `  ⬇️ Demoted (if admin)\n` +
                `  ⚠️ Warning issued\n` +
                `  🚫 Kicked from group\n\n` +
                `_Bot owners are always exempt._\n\n` +
                `*Commands:*\n` +
                `  .antikickall on  — enable protection\n` +
                `  .antikickall off — disable protection`
            );
        }

        if (sub === 'on') {
            database.updateGroupSettings(from, { antikickall: true });
            return reply(
                `✅ *Anti-KickAll ENABLED*\n\n` +
                `Anyone who tries to use:\n${blockedList}\n\n` +
                `…will be *demoted, warned, and kicked* immediately.`
            );
        }

        if (sub === 'off') {
            database.updateGroupSettings(from, { antikickall: false });
            return reply('❌ *Anti-KickAll* disabled. Group-destruction commands are no longer blocked.');
        }

        return reply('⚠️ Usage: .antikickall on | off | status');
    }
};
