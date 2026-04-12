/**
 * Antilink Command - Toggle antilink protection with delete/warn/kick options
 */

const database = require('../../database');

module.exports = {
  name: 'antilink',
  aliases: [],
  category: 'admin',
  description: 'Configure antilink protection (delete/warn/kick)',
  usage: '.antilink <on|off|set|get>',
  groupOnly: true,
  adminOnly: true,
  botAdminNeeded: true,

  async execute(sock, msg, args, extra) {
    try {
      const { from, reply } = extra;
      const opt = (args[0] || '').toLowerCase();
      const sub = (args[1] || '').toLowerCase();

      if (!opt) {
        const settings = database.getGroupSettings(from);
        const status   = settings.antilink ? 'ON' : 'OFF';
        const action   = settings.antilinkAction || 'delete';
        return reply(
          `🔗 *Antilink Status*\n\n` +
          `Status: *${status}*\n` +
          `Action: *${action}*\n\n` +
          `Commands:\n` +
          `  .antilink on\n` +
          `  .antilink off\n` +
          `  .antilink set delete | warn | kick\n` +
          `  .antilink get\n\n` +
          `_warn: deletes link + issues a warning. At max warnings the user is removed._`
        );
      }

      if (opt === 'on') {
        if (database.getGroupSettings(from).antilink)
          return reply('ℹ️ Antilink is already *ON*.');
        database.updateGroupSettings(from, { antilink: true });
        return reply('✅ Antilink turned *ON*.\nDefault action: *delete*.\nChange with *.antilink set warn* or *.antilink set kick*.');
      }

      if (opt === 'off') {
        database.updateGroupSettings(from, { antilink: false });
        return reply('❌ Antilink turned *OFF*.');
      }

      if (opt === 'set') {
        if (!sub) return reply('⚠️ Usage: *.antilink set delete | warn | kick*');
        if (!['delete', 'warn', 'kick'].includes(sub))
          return reply('❌ Invalid action. Choose: *delete*, *warn*, or *kick*.');
        database.updateGroupSettings(from, {
          antilinkAction: sub,
          antilink: true,
        });
        return reply(`✅ Antilink action set to *${sub}*. Antilink is now *ON*.`);
      }

      if (opt === 'get') {
        const settings = database.getGroupSettings(from);
        const status   = settings.antilink ? 'ON' : 'OFF';
        const action   = settings.antilinkAction || 'delete';
        return reply(`🔗 *Status:* ${status}\n🔗 *Action:* ${action}`);
      }

      return reply('❓ Unknown option. Type *.antilink* for usage.');

    } catch (error) {
      await extra.reply(`❌ Error: ${error.message}`);
    }
  },
};
