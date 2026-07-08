/**
 * ╔══════════════════════════════════════════╗
 * ║  FILE    : anticontact.js                ║
 * ║  FEATURE : Anti-Contact Card             ║
 * ║  SCOPE   : Admin — Group Only            ║
 * ║  CMDS    : .anticontact on/off/action    ║
 * ║  ACTIONS : delete | warn | kick          ║
 * ╚══════════════════════════════════════════╝
 */

const database = require(require('path').join(global.__CORE__, 'database'));

module.exports = {
    name: 'anticontact',
    aliases: ['nocontact', 'anticard'],
    category: 'admin',
    description: 'Block contact cards shared in group (delete/warn/kick)',
    usage: '.anticontact on | off | action delete|warn|kick',
    groupOnly: true,
    adminOnly: true,
    botAdminNeeded: true,

    async execute(sock, msg, args, extra) {
        const { from, reply } = extra;
        const gs  = database.getGroupSettings(from);
        const sub = (args[0] || '').toLowerCase();

        if (!sub) {
            const action = gs.anticontactAction || 'delete';
            return reply(
                `📇 *Anti-Contact Settings*\n` +
                `━━━━━━━━━━━━━━━\n` +
                `📌 Status: *${gs.anticontact ? '✅ ON' : '❌ OFF'}*\n` +
                `⚡ Action: *${action}*\n\n` +
                `*Commands:*\n` +
                `  .anticontact on               — enable\n` +
                `  .anticontact off              — disable\n` +
                `  .anticontact action delete    — silently delete contact cards\n` +
                `  .anticontact action warn      — warn; kick at max warnings\n` +
                `  .anticontact action kick      — immediately kick sender\n\n` +
                `_Admins and bot owner are always exempt._`
            );
        }

        if (sub === 'on') {
            database.updateGroupSettings(from, { anticontact: true });
            const action = gs.anticontactAction || 'delete';
            return reply(`✅ *Anti-Contact* enabled.\nAction: *${action}*.\n_Contact cards sent by non-admins will be ${action}d._`);
        }

        if (sub === 'off') {
            database.updateGroupSettings(from, { anticontact: false });
            return reply('❌ *Anti-Contact* disabled.');
        }

        if (sub === 'action') {
            const act = (args[1] || '').toLowerCase();
            if (!['delete', 'warn', 'kick'].includes(act)) {
                return reply('⚠️ Valid actions: delete | warn | kick');
            }
            database.updateGroupSettings(from, { anticontactAction: act });
            return reply(`✅ Anti-Contact action set to *${act}*.`);
        }

        return reply('⚠️ Unknown option. Use .anticontact for help.');
    }
};
