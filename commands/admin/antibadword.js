/**
 * AntiBadWord Command - Filter bad words in group chats
 * Actions: kick, delete, warn
 * Manage word list: antibadword add <word> | antibadword delete <word>
 */

const database = require('../../database');
const config = require('../../config');

module.exports = {
  name: 'antibadword',
  aliases: ['abw', 'badword'],
  category: 'admin',
  description: 'Filter bad/offensive words in group with kick, delete, or warn action',
  usage: '.antibadword <on/off/set/list/add/delete>',
  groupOnly: true,
  adminOnly: true,
  botAdminNeeded: true,

  async execute(sock, msg, args, extra) {
    try {
      const { from, reply } = extra;

      if (!args[0]) {
        const settings = database.getGroupSettings(from);
        const status = settings.antibadword ? 'ON' : 'OFF';
        const action = settings.antibadwordAction || 'warn';
        const words = database.getBadWords(from);
        return reply(
          `🤬 *AntiBadWord Status*\n\n` +
          `Status: *${status}*\n` +
          `Action: *${action}*\n` +
          `Bad Words: *${words.length}* word(s)\n\n` +
          `*Usage:*\n` +
          `  .antibadword on\n` +
          `  .antibadword off\n` +
          `  .antibadword set <kick|delete|warn>\n` +
          `  .antibadword add <word>\n` +
          `  .antibadword delete <word>\n` +
          `  .antibadword list`
        );
      }

      const opt = args[0].toLowerCase();

      if (opt === 'on') {
        if (database.getGroupSettings(from).antibadword) {
          return reply('*AntiBadWord is already ON*');
        }
        database.updateGroupSettings(from, { antibadword: true });
        return reply('✅ *AntiBadWord has been turned ON*');
      }

      if (opt === 'off') {
        database.updateGroupSettings(from, { antibadword: false });
        return reply('❌ *AntiBadWord has been turned OFF*');
      }

      if (opt === 'set') {
        if (!args[1]) {
          return reply('*Please specify an action:*\n.antibadword set kick | delete | warn');
        }
        const action = args[1].toLowerCase();
        if (!['kick', 'delete', 'warn'].includes(action)) {
          return reply('*Invalid action.* Choose one of: kick, delete, warn');
        }
        database.updateGroupSettings(from, {
          antibadwordAction: action,
          antibadword: true
        });
        return reply(`✅ *AntiBadWord action set to* _${action}_ *(and turned ON)*`);
      }

      if (opt === 'add') {
        if (!args[1]) {
          return reply('*Please specify a word to add.*\nExample: .antibadword add fuck');
        }
        const word = args[1].toLowerCase().trim();
        const added = database.addBadWord(from, word);
        if (added) {
          return reply(`✅ *"${word}"* has been added to the bad words list.`);
        }
        return reply(`⚠️ *"${word}"* is already in the bad words list.`);
      }

      if (opt === 'delete' || opt === 'remove') {
        if (!args[1]) {
          return reply('*Please specify a word to remove.*\nExample: .antibadword delete fuck');
        }
        const word = args[1].toLowerCase().trim();
        const removed = database.removeBadWord(from, word);
        if (removed) {
          return reply(`✅ *"${word}"* has been removed from the bad words list.`);
        }
        return reply(`⚠️ *"${word}"* was not found in the bad words list.`);
      }

      if (opt === 'list') {
        const words = database.getBadWords(from);
        if (!words.length) {
          return reply('📋 *Bad Words List is empty.*\nAdd words using: .antibadword add <word>');
        }
        return reply(
          `📋 *Bad Words List (${words.length})*\n\n` +
          words.map((w, i) => `${i + 1}. ${w}`).join('\n') +
          `\n\nRemove with: .antibadword delete <word>`
        );
      }

      return reply('⚠️ Unknown option. Use *.antibadword* to see usage.');

    } catch (error) {
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};
