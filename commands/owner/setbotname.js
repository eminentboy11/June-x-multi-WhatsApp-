/**
 * Set Bot Name Command — persists via database/bot-settings.json
 */
const config = require('../../config');
const db = require('../../database');

const DEFAULT_BOT_NAME = 'JuneX-Ultra';

module.exports = {
  name: 'setbotname',
  aliases: ['setname', 'botname'],
  category: 'owner',
  description: 'Change bot name (use "reset" to restore default)',
  usage: '.setbotname <new name> | .setbotname reset',
  ownerOnly: true,

  async execute(sock, msg, args, extra) {
    try {
      let newBotName = '';
      let isReset = false;

      const firstArg = (args[0] || '').toLowerCase();
      if (firstArg === 'reset' || firstArg === 'default' || firstArg === 'restore') {
        newBotName = DEFAULT_BOT_NAME;
        isReset = true;
      } else {
        // Check if message is a reply
        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (quotedMsg) {
          const quotedText = quotedMsg.conversation ||
                            quotedMsg.extendedTextMessage?.text ||
                            quotedMsg.imageMessage?.caption ||
                            quotedMsg.videoMessage?.caption ||
                            '';
          newBotName = quotedText.trim();
        } else {
          newBotName = args.join(' ').trim();
        }
      }

      // Validate
      if (!newBotName) {
        return extra.reply(
          `📝 *Set Bot Name*\n\n` +
          `Current bot name: *${config.botName}*\n` +
          `Default bot name:  *${DEFAULT_BOT_NAME}*\n\n` +
          `Usage:\n` +
          `  .setbotname <new name>\n` +
          `  .setbotname reset    — restore default\n` +
          `  Or reply to a message with .setbotname`
        );
      }

      if (newBotName.length > 50) {
        return extra.reply('❌ Bot name must be 50 characters or less!');
      }

      // Persist to database and update runtime config
      db.setBotSetting('botName', newBotName);
      config.botName = newBotName;

      const headline = isReset
        ? `✅ Bot name reset to default: *${newBotName}*`
        : `✅ Bot name changed to: *${newBotName}*`;
      await extra.reply(`${headline}\n\nThe new name will be used in menus and other places.`);

    } catch (error) {
      console.error('Setbotname command error:', error);
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};
