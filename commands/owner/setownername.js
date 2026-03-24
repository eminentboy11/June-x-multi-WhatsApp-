const config = require('../../config');
const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'setownername',
  aliases: ['setowner_name'],
  category: 'owner',
  description: 'Change the bot owner display name',
  usage: '.setownername <new name>',
  ownerOnly: true,

  async execute(sock, msg, args, extra) {
    try {
      let newName = '';

      const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      if (quotedMsg) {
        newName = (quotedMsg.conversation || quotedMsg.extendedTextMessage?.text || '').trim();
      } else {
        newName = args.join(' ').trim();
      }

      if (!newName) {
        const current = Array.isArray(config.ownerName) ? config.ownerName[0] : config.ownerName;
        return extra.reply(`👑 *Set Owner Name*\n\nCurrent: *${current}*\n\nUsage: ${config.prefix}setownername <new name>`);
      }

      if (newName.length > 50) {
        return extra.reply('❌ Owner name must be 50 characters or less!');
      }

      if (Array.isArray(config.ownerName)) {
        config.ownerName[0] = newName;
      } else {
        config.ownerName = newName;
      }

      const configPath = path.join(__dirname, '../../config.js');
      let configContent = fs.readFileSync(configPath, 'utf-8');
      configContent = configContent.replace(
        /ownerName:\s*\[([^\]]*)\]/,
        (match, inner) => {
          const parts = inner.split(',').map(s => s.trim());
          if (parts.length > 0) {
            parts[0] = `'${newName.replace(/'/g, "\\'")}'`;
          }
          return `ownerName: [${parts.join(', ')}]`;
        }
      );
      fs.writeFileSync(configPath, configContent, 'utf-8');

      delete require.cache[require.resolve('../../config')];

      await extra.reply(`✅ Owner name changed to: *${newName}*`);
    } catch (error) {
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};
