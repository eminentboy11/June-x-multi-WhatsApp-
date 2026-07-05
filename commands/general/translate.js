/**
 * Translate Command - Translate text to different languages
 */

const APIs = require('../../utils/api');

module.exports = {
  name: 'translate',
  aliases: ['tr', 'trans'],
  category: 'general',
  description: 'Translate text to another language',
  usage: '.translate <lang code> <text>',
  
  async execute(sock, msg, args, extra) {
    try {
      if (args.length < 2) {
        return extra.reply(
          '❌ Usage: .tr <lang> <text>\n\n' +
          'Examples: en, es, fr, de, it, pt, ru, ja, ko, sw'
        );
      }
      
      const targetLang = args[0];
      const text = args.slice(1).join(' ');
      
      const result = await APIs.translate(text, targetLang);
      const translated = result.translation || result;
      
      await extra.reply(`🌐 *${targetLang.toUpperCase()}*\n${translated}`);
      
    } catch (error) {
      console.error('[translate]', error.message);
      await extra.reply('❌ Translation failed.');
    }
  }
};
