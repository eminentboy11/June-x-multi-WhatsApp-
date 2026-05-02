/**
 * AntiVideo — deletes, warns, or kicks members who send videos in a group.
 *
 * Actions:
 *   delete  → silently removes the video (default)
 *   warn    → issues a warning; auto-kicks at max warnings
 *   kick    → immediately removes the sender
 *
 * Admins and the bot owner are always exempt.
 * Bot must be admin to delete messages / kick members.
 */

const database = require('../../database');
const config   = require('../../config');

module.exports = {
    name: 'antivideo',
    aliases: ['novideo', 'antivid'],
    category: 'admin',
    description: 'Block videos in group — delete, warn, or kick the sender',
    usage: '.antivideo on | off | action delete|warn|kick',
    groupOnly: true,
    adminOnly: true,

    async execute(sock, msg, args, extra) {
        const { from, reply } = extra;
        const gs  = database.getGroupSettings(from);
        const sub = (args[0] || '').toLowerCase();

        if (!sub) {
            const action = gs.antivideoAction || 'delete';
            return reply(
                `🎬 *Anti-Video Settings*\n` +
                `━━━━━━━━━━━━━━━\n` +
                `📌 Status: *${gs.antivideo ? '✅ ON' : '❌ OFF'}*\n` +
                `⚡ Action: *${action}*\n\n` +
                `*Commands:*\n` +
                `  .antivideo on               — enable\n` +
                `  .antivideo off              — disable\n` +
                `  .antivideo action delete    — silently delete videos\n` +
                `  .antivideo action warn      — warn; kick at max warnings\n` +
                `  .antivideo action kick      — immediately kick sender\n\n` +
                `_Admins and bot owner are always exempt._`
            );
        }

        if (sub === 'on') {
            database.updateGroupSettings(from, { antivideo: true });
            const action = gs.antivideoAction || 'delete';
            return reply(`✅ *Anti-Video* enabled.\nAction: *${action}*.\n_Videos sent by non-admins will be ${action}ed._`);
        }

        if (sub === 'off') {
            database.updateGroupSettings(from, { antivideo: false });
            return reply('❌ *Anti-Video* disabled.');
        }

        if (sub === 'action') {
            const act = (args[1] || '').toLowerCase();
            if (!['delete', 'warn', 'kick'].includes(act)) {
                return reply('⚠️ Valid actions: delete | warn | kick');
            }
            database.updateGroupSettings(from, { antivideoAction: act });
            return reply(`✅ Anti-Video action set to *${act}*.`);
        }

        return reply('⚠️ Unknown option. Use .antivideo for help.');
    }
};
