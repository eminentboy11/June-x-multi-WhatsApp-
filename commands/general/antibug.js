/**
 * ╔════════════════════════════════════════════════╗
 * ║  FILE    : antibug.js                          ║
 * ║  FEATURE : AntiBug — Crash Message Protection  ║
 * ║  SCOPE   : Owner — Global (Groups + DMs)       ║
 * ║  CMDS    : .antibug on/off/action/status       ║
 * ║  ACTIONS : delete | warn | kick                ║
 * ║  DM      : auto-block sender + notify owner    ║
 * ║  GROUP   : delete+act (admin) / leave (no adm) ║
 * ╚════════════════════════════════════════════════╝
 *
 * AntiBug — global crash-message protection
 *
 * Monitors ALL messages (groups + DMs) for known WhatsApp crash/bug patterns.
 *
 * In a GROUP:
 *   • Bot is admin  → delete message + take action (warn/kick) on sender
 *   • Bot NOT admin → leave the group immediately (bot self-protection)
 *
 * In a DM:
 *   → Block the sender + notify the bot owner
 *
 * This is a global bot-wide setting (stored in bot-settings.json).
 * Toggle with .antibug on/off. Action changed with .antibug action warn|kick|delete.
 */

const database = require(require('path').join(global.__CORE__, 'database'));

module.exports = {
    name: 'antibug',
    aliases: ['bugprotect', 'crashprotect'],
    category: 'owner',
    description: 'Global crash-message protection — blocks WhatsApp bug messages in groups & DMs',
    usage: '.antibug on | off | action delete|warn|kick | status',
    ownerOnly: true,

    async execute(sock, msg, args, extra) {
        const { from, reply } = extra;
        const sub = (args[0] || '').toLowerCase();

        const enabled = database.getBotSetting('antibug') ?? false;
        const action  = database.getBotSetting('antibugAction') || 'delete';

        if (!sub || sub === 'status') {
            return reply(
                `🛡️ *AntiBug* — ${enabled ? '✅ ON' : '❌ OFF'} (action: *${action}*)\n\n` +
                `Group: admin → delete+${action} | not admin → leave\n` +
                `DM: block sender + notify owner\n\n` +
                `.antibug on/off\n` +
                `.antibug action delete|warn|kick`
            );
        }

        if (sub === 'on') {
            database.setBotSetting('antibug', true);
            return reply(`🛡️ *AntiBug turned ON*\nAction (groups): *${action}*`);
        }

        if (sub === 'off') {
            database.setBotSetting('antibug', false);
            return reply('🛡️ *AntiBug turned OFF*');
        }

        if (sub === 'action') {
            const act = (args[1] || '').toLowerCase();
            if (!['delete', 'warn', 'kick'].includes(act)) {
                return reply('⚠️ Valid actions: delete | warn | kick');
            }
            database.setBotSetting('antibugAction', act);
            return reply(`✅ AntiBug group action set to *${act}*.`);
        }

        return reply('⚠️ Unknown option. Use .antibug for help.');
    }
};
