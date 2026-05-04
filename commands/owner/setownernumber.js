const config = require(require('path').join(global.__ROOT__, 'config'));
const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'setownernumber',
  aliases: ['setowner_number', 'setown'],
  category: 'owner',
  description: 'Change the bot owner number',
  usage: '.setownernumber <number>',
  ownerOnly: true,

  async execute(sock, msg, args, extra) {
    try {
      let newNumber = '';

      const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
      if (mentioned && mentioned.length > 0) {
        newNumber = mentioned[0].split('@')[0];
      } else if (args.length > 0) {
        newNumber = args[0].replace(/[^0-9]/g, '');
      }

      if (!newNumber) {
        const current = Array.isArray(config.ownerNumber) ? config.ownerNumber[0] : config.ownerNumber;
        return extra.reply(`📱 *Set Owner Number*\n\nCurrent: *${current}*\n\nUsage:\n${config.prefix}setownernumber <number>\n${config.prefix}setownernumber @mention`);
      }

      if (newNumber.length < 7 || newNumber.length > 15) {
        return extra.reply('❌ Invalid phone number! Must be 7-15 digits.');
      }

      if (Array.isArray(config.ownerNumber)) {
        config.ownerNumber[0] = newNumber;
      } else {
        config.ownerNumber = newNumber;
      }

      const configPath = path.join(__dirname, '../../config.js');
      let configContent = fs.readFileSync(configPath, 'utf-8');
      configContent = configContent.replace(
        /ownerNumber:\s*\[([^\]]*)\]/,
        (match, inner) => {
          const parts = inner.split(',').map(s => s.trim());
          if (parts.length > 0) {
            parts[0] = `'${newNumber}'`;
          }
          return `ownerNumber: [${parts.join(',')}]`;
        }
      );
      fs.writeFileSync(configPath, configContent, 'utf-8');

      delete require.cache[require.resolve('../../config')];

      await extra.reply(`✅ Owner number changed to: *${newNumber}*`);
    } catch (error) {
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};
