/**
 * TTS - Text to Speech Command
 * Uses Google Translate TTS (no API key required).
 * Usage: .say <text>
 *        .say <lang> <text>   e.g. .say fr Bonjour le monde
 */

const axios = require('axios');

// Common language codes users might pass as first arg
const LANG_CODES = new Set([
  'af','sq','am','ar','hy','az','eu','be','bn','bs','bg','ca','ceb','zh',
  'co','hr','cs','da','nl','en','eo','et','fi','fr','fy','gl','ka','de',
  'el','gu','ht','ha','haw','iw','hi','hmn','hu','is','ig','id','ga','it',
  'ja','jw','kn','kk','km','rw','ko','ku','ky','lo','la','lv','lt','lb',
  'mk','mg','ms','ml','mt','mi','mr','mn','my','ne','no','ny','or','ps',
  'fa','pl','pt','pa','ro','ru','sm','gd','sr','st','sn','sd','si','sk',
  'sl','so','es','su','sw','sv','tl','tg','ta','tt','te','th','tr','tk',
  'uk','ur','ug','uz','vi','cy','xh','yi','yo','zu',
]);

module.exports = {
  name: 'tts',
  aliases: ['speak', 'say'],
  category: 'general',
  description: 'Convert text to speech',
  usage: '.say <text>  OR  .say <lang> <text>',

  async execute(sock, msg, args, extra) {
    try {
      if (!args.length) {
        return extra.reply(
          `Please provide text.\nExample: ${extra.prefix || '.'}say Hello there!\nWith language: ${extra.prefix || '.'}say fr Bonjour le monde`
        );
      }

      // Detect optional language code as first arg
      let lang = 'en';
      let textArgs = args;
      if (args.length > 1 && LANG_CODES.has(args[0].toLowerCase())) {
        lang = args[0].toLowerCase();
        textArgs = args.slice(1);
      }

      const text = textArgs.join(' ').trim();
      if (!text) return extra.reply('❌ No text provided after the language code.');
      if (text.length > 200) return extra.reply('❌ Text too long! Maximum 200 characters.');

      await extra.reply('🔊 Generating speech...');

      const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${lang}&client=tw-ob`;

      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://translate.google.com/',
        },
      });

      const audioBuffer = Buffer.from(response.data);
      if (audioBuffer.length < 100) throw new Error('Empty audio returned from TTS service');

      await sock.sendMessage(
        extra.from,
        { audio: audioBuffer, mimetype: 'audio/mpeg', ptt: true },
        { quoted: msg }
      );

    } catch (error) {
      console.error('TTS command error:', error);
      await extra.reply(`❌ Failed to generate speech: ${error.message}`);
    }
  },
};
