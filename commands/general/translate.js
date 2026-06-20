/**
 * Translate Command - Translate text to different languages
 */

const APIs = require('../../utils/api');

module.exports = {
  name: 'translate',
  aliases: ['trt', 'trans'],
  category: 'general',
  description: 'Translate text to another language',
  usage: '.translate [lang code] <text>',

  async execute(sock, msg, args, extra) {
    try {
      if (args.length < 1) {
        return extra.reply('❌ Usage: .translate [lang] <text>\n\nExamples:\n• .translate es Hello world\n• .translate Hello world  _(defaults to English)_');
      }

      // Known language codes (2-letter ISO 639-1)
      const langCodeRegex = /^[a-zA-Z]{2}(-[a-zA-Z]{2,4})?$/;

      let targetLang;
      let text;
      let sourceLang = 'auto';

      if (langCodeRegex.test(args[0]) && args.length >= 2) {
        // User specified a target language
        targetLang = args[0].toLowerCase();
        text = args.slice(1).join(' ');
      } else {
        // No lang code — default to English
        targetLang = 'en';
        text = args.join(' ');
      }

      const result = await APIs.translate(text, targetLang, sourceLang);

      // Support result as object or plain string
      const translated = result?.translation ?? result;
      const detectedLang = result?.sourceLang ?? result?.detected ?? sourceLang;

      const fromLabel = detectedLang && detectedLang !== 'auto'
        ? detectedLang.toUpperCase()
        : 'Auto-detected';

      let replyText = `🌐 *Translation*\n\n`;
      replyText += `📝 *Original:* ${text}\n`;
      replyText += `🔤 *Translated:* ${translated}\n\n`;
      replyText += `_${fromLabel} → ${targetLang.toUpperCase()}_`;

      await extra.reply(replyText);

    } catch (error) {
      await extra.reply(`❌ Translation failed!\n\nSupported codes: en, es, fr, de, it, pt, ru, ja, ko, zh\n\nError: ${error.message}`);
    }
  }
};
