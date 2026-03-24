const database = require('../../database');
const config = require('../../config');

module.exports = {
  name: 'antigroupstatus',
  aliases: ['ags', 'antistatus'],
  category: 'admin',
  description: 'Block status mentions in group (warn/kick/delete)',
  usage: '.antigroupstatus <on/off/set/get>',
  groupOnly: true,
  adminOnly: true,
  botAdminNeeded: true,

  async execute(sock, msg, args, extra) {
    try {
      const settings = database.getGroupSettings(extra.from);
      const current = settings.antigroupstatus ? 'ON' : 'OFF';
      const action = settings.antigroupstatusAction || 'delete';

      if (!args[0]) {
        return extra.reply(
          `🛡️ *Anti Group Status*\n━━━━━━━━━━━━━━━\n\n` +
          `📌 Status: *${current}*\n` +
          `⚡ Action: *${action}*\n\n` +
          `*Usage:*\n` +
          `  .antigroupstatus on\n` +
          `  .antigroupstatus off\n` +
          `  .antigroupstatus set warn\n` +
          `  .antigroupstatus set kick\n` +
          `  .antigroupstatus set delete\n` +
          `  .antigroupstatus get\n\n` +
          `_Blocks WhatsApp status that mention this group_`
        );
      }

      const opt = args[0].toLowerCase();

      if (opt === 'on') {
        if (settings.antigroupstatus) {
          return extra.reply('🛡️ *Anti Group Status is already ON*');
        }
        database.updateGroupSettings(extra.from, { antigroupstatus: true });
        return extra.reply(`🛡️ *Anti Group Status turned ON*\n⚡ Action: *${action}*`);
      }

      if (opt === 'off') {
        database.updateGroupSettings(extra.from, { antigroupstatus: false });
        return extra.reply('🛡️ *Anti Group Status turned OFF*');
      }

      if (opt === 'set') {
        if (args.length < 2) {
          return extra.reply('⚠️ *Specify an action:*\n\n.antigroupstatus set warn\n.antigroupstatus set kick\n.antigroupstatus set delete');
        }
        const setAction = args[1].toLowerCase();
        if (!['warn', 'kick', 'delete'].includes(setAction)) {
          return extra.reply('❌ *Invalid action.* Choose: warn, kick, or delete');
        }
        database.updateGroupSettings(extra.from, {
          antigroupstatusAction: setAction,
          antigroupstatus: true,
        });
        return extra.reply(`🛡️ *Anti Group Status action set to ${setAction}*`);
      }

      if (opt === 'get') {
        return extra.reply(
          `🛡️ *Anti Group Status Config*\n━━━━━━━━━━━━━━━\n\n` +
          `📌 Status: *${current}*\n` +
          `⚡ Action: *${action}*`
        );
      }

      return extra.reply('⚠️ *Use .antigroupstatus for usage info.*');

    } catch (error) {
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};
