/**
 * TTS - Text to Speech Command
 * Uses Google Translate TTS (no API key required).
 * Usage: .say <text>
 *        .say <lang> <text>         e.g. .say fr Bonjour le monde
 *        .say  (reply to a message) — speaks the quoted text
 *        .say fr  (reply to a message) — speaks the quoted text in French
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

// Extract plain text from any quoted message type
function getQuotedText(msg) {
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  if (!ctx?.quotedMessage) return null;
  const q = ctx.quotedMessage;
  return (
    q.conversation ||
    q.extendedTextMessage?.text ||
    q.imageMessage?.caption ||
    q.videoMessage?.caption ||
    q.documentMessage?.caption ||
    null
  );
}

module.exports = {
  name: 'tts',
  aliases: ['speak', 'say'],
  category: 'general',
  description: 'Convert text to speech',
  usage: '.say <text>  |  .say <lang> <text>  |  reply to a message with .say',

  async execute(sock, msg, args, extra) {
    try {
      // Detect optional language code as first arg
      let lang = 'en';
      let textArgs = args;
      if (args.length >= 1 && LANG_CODES.has(args[0].toLowerCase())) {
        lang = args[0].toLowerCase();
        textArgs = args.slice(1);
      }

      // If no inline text, fall back to the quoted message's text
      let text = textArgs.join(' ').trim();
      if (!text) {
        const quoted = getQuotedText(msg);
        if (quoted) {
          text = quoted.trim();
        } else {
          const p = extra.prefix || '.';
          return extra.reply(
            `🔊 *Text to Speech*\n\n` +
            `*Usage:*\n` +
            `• _${p}say <text>_ — speak text in English\n` +
            `• _${p}say <lang> <text>_ — speak in a specific language\n` +
            `• Reply to any message with _${p}say_ — speak the quoted text\n` +
            `• Reply with _${p}say <lang>_ — speak quoted text in chosen language\n\n` +
            `*Common language codes:*\n` +
            `\`en\` English  |  \`sw\` Swahili  |  \`fr\` French\n` +
            `\`ar\` Arabic   |  \`hi\` Hindi    |  \`es\` Spanish\n` +
            `\`de\` German   |  \`zh\` Chinese  |  \`pt\` Portuguese\n` +
            `\`ja\` Japanese |  \`ko\` Korean   |  \`ru\` Russian\n\n` +
            `*Examples:*\n` +
            `_${p}say Hello World_\n` +
            `_${p}say sw Habari yako_\n` +
            `_${p}say fr_ _(reply to a message)_`
          );
        }
      }

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
