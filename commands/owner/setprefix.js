const config = require('../../config');
const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'setprefix',
  aliases: ['prefix'],
  category: 'owner',
  description: 'Change bot command prefix. Use "none" for no prefix.',
  usage: '.setprefix <new prefix | none>',
  ownerOnly: true,
  
  async execute(sock, msg, args, extra) {
    try {
      if (args.length === 0) {
        const current = config.prefix || '(none)';
        return extra.reply(`📌 Current prefix: ${current}\n\nUsage: ${config.prefix || ''}setprefix <new prefix>\nUse *${config.prefix || ''}setprefix none* to remove the prefix.`);
      }
      
      const input = args[0].toLowerCase();
      const newPrefix = input === 'none' ? '' : args[0];
      
      if (newPrefix.length > 3) {
        return extra.reply('❌ Prefix must be 1-3 characters long!');
      }
      
      config.prefix = newPrefix;
      
      const configPath = path.join(__dirname, '../../config.js');
      let configContent = fs.readFileSync(configPath, 'utf-8');
      configContent = configContent.replace(/prefix: '.*?'/, `prefix: '${newPrefix}'`);
      fs.writeFileSync(configPath, configContent);
      
      if (newPrefix === '') {
        await extra.reply(`✅ Prefix removed! Commands now work without a prefix.\n\nExample: menu, ping, help`);
      } else {
        await extra.reply(`✅ Prefix changed to: ${newPrefix}\n\nNew command format: ${newPrefix}command`);
      }
      
    } catch (error) {
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};
