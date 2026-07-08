/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FILE    : antilink.js                                       ║
 * ║  FEATURE : Antilink Protection                               ║
 * ║  SCOPE   : Admin — Group only                                ║
 * ║  CMDS    : .antilink on | off | delete | kick | warn         ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * .antilink on     → enable (keeps last action, default: delete)
 * .antilink off    → disable
 * .antilink delete → enable + set action to delete
 * .antilink kick   → enable + set action to kick
 * .antilink warn   → enable + set action to warn (auto-kick at max warns)
 */

const database = require(require('path').join(global.__CORE__, 'database'));
const config   = require(require('path').join(global.__ROOT__, 'config'));

module.exports = {
    name: 'antilink',
    aliases: ['al'],
    category: 'admin',
    description: 'Block links in the group — delete, kick, or warn the sender',
    usage: '.antilink on | off | delete | kick | warn',
    groupOnly: true,
    adminOnly: true,
    botAdminNeeded: true,

    async execute(sock, msg, args, extra) {
        try {
            const { from, isOwner, isAdmin, reply, react } = extra;
            const gs  = database.getGroupSettings(from);
            const sub = (args[0] || '').toLowerCase();

            // ── No args / status ──────────────────────────────────────────────
            if (!sub || sub === 'status') {
                const status = gs.antilink ? '✅ ON' : '❌ OFF';
                const action = gs.antilinkAction || 'delete';
                const actionLabel = {
                    delete: '🗑️ Delete message',
                    kick:   '👢 Delete + kick sender',
                    warn:   `⚠️ Delete + warn (kick at ${config.maxWarnings || 3} warns)`,
                }[action] || action;

                return reply(
                    `🔗 *Antilink*\n` +
                    `Status: *${status}* | Action: *${actionLabel}*\n\n` +
                    `.antilink delete | kick | warn | on | off`
                );
            }

            // ── ON ────────────────────────────────────────────────────────────
            if (sub === 'on') {
                if (gs.antilink) return reply('ℹ️ Antilink is already *ON*.');
                database.updateGroupSettings(from, { antilink: true });
                const action = gs.antilinkAction || 'delete';
                await react('✅');
                return reply(`🔗 *Antilink ON* ✅\nAction: *${action}*`);
            }

            // ── OFF ───────────────────────────────────────────────────────────
            if (sub === 'off') {
                database.updateGroupSettings(from, { antilink: false });
                await react('❌');
                return reply('🔗 *Antilink OFF* ❌\nLinks are now allowed in this group.');
            }

            // ── DELETE / KICK / WARN — enable and set action in one step ──────
            if (['delete', 'kick', 'warn'].includes(sub)) {
                database.updateGroupSettings(from, { antilink: true, antilinkAction: sub });
                const label = {
                    delete: '🗑️ delete the message',
                    kick:   '👢 delete + kick sender',
                    warn:   `⚠️ delete + warn sender (kick at ${config.maxWarnings || 3} warnings)`,
                }[sub];
                await react('✅');
                return reply(`🔗 *Antilink ON* ✅\nAction: *${label}*`);
            }

            return reply('❓ Unknown option.\nUsage: *.antilink delete | kick | warn | on | off*');

        } catch (err) {
            await extra.reply(`❌ Error: ${err.message}`);
        }
    },
};
