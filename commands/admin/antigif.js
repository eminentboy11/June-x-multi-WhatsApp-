/**
 * ╔══════════════════════════════════════════╗
 * ║  FILE    : antigif.js                    ║
 * ║  FEATURE : Anti-GIF                      ║
 * ║  SCOPE   : Admin — Group Only            ║
 * ║  CMDS    : .antigif on/off/action        ║
 * ║  ACTIONS : delete | warn | kick          ║
 * ╚══════════════════════════════════════════╝
 */

const database = require(require('path').join(global.__CORE__, 'database'));

module.exports = {
    name: 'antigif',
    aliases: ['nogif', 'blockgif'],
    category: 'admin',
    description: 'Block GIFs in group (delete/warn/kick)',
    usage: '.antigif on | off | action delete|warn|kick',
    groupOnly: true,
    adminOnly: true,
    botAdminNeeded: true,

    async execute(sock, msg, args, extra) {
        const { from, reply } = extra;
        const gs  = database.getGroupSettings(from);
        const sub = (args[0] || '').toLowerCase();

        if (!sub) {
            const action = gs.antigifAction || 'delete';
            return reply(
                `🎞️ *Anti-GIF Settings*\n` +
                `━━━━━━━━━━━━━━━\n` +
                `📌 Status: *${gs.antigif ? '✅ ON' : '❌ OFF'}*\n` +
                `⚡ Action: *${action}*\n\n` +
                `*Commands:*\n` +
                `  .antigif on               — enable\n` +
                `  .antigif off              — disable\n` +
                `  .antigif action delete    — silently delete GIFs\n` +
                `  .antigif action warn      — warn; kick at max warnings\n` +
                `  .antigif action kick      — immediately kick sender\n\n` +
                `_Admins and bot owner are always exempt._`
            );
        }

        if (sub === 'on') {
            database.updateGroupSettings(from, { antigif: true });
            const action = gs.antigifAction || 'delete';
            return reply(`✅ *Anti-GIF* enabled.\nAction: *${action}*.\n_GIFs sent by non-admins will be ${action}d._`);
        }

        if (sub === 'off') {
            database.updateGroupSettings(from, { antigif: false });
            return reply('❌ *Anti-GIF* disabled.');
        }

        if (sub === 'action') {
            const act = (args[1] || '').toLowerCase();
            if (!['delete', 'warn', 'kick'].includes(act)) {
                return reply('⚠️ Valid actions: delete | warn | kick');
            }
            database.updateGroupSettings(from, { antigifAction: act });
            return reply(`✅ Anti-GIF action set to *${act}*.`);
        }

        return reply('⚠️ Unknown option. Use .antigif for help.');
    }
};
