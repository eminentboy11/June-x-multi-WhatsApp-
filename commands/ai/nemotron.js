/**
 * Nemotron — NVIDIA Nemotron Nano 12B VL
 * Text chat + image understanding (vision-language model).
 *
 * Usage:
 *   .nemotron <question>                     → text chat
 *   .nemotron <question> https://...jpg      → vision via image URL
 *   reply to an image with .nemotron <q>     → vision via uploaded image
 */

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { chat, vision, DEFAULT_MODEL } = require(require('path').join(global.__CORE__, 'utils', 'nvidia'));
const config = require(require('path').join(global.__ROOT__, 'config'));

const URL_RE = /\bhttps?:\/\/\S+\.(?:jpe?g|png|webp|gif|bmp)(?:\?\S*)?/i;

function getOwnerName() {
  const o = config.ownerName;
  if (Array.isArray(o)) return (o.find(Boolean) || 'OWNER');
  return o || 'OWNER';
}

module.exports = {
  name: 'nemotron',
  aliases: ['nemo', 'nemoai', 'nvai', 'vlm'],
  category: 'ai',
  description: 'NVIDIA Nemotron Nano 12B VL — text chat + image understanding',
  usage: '.nemotron <question>  |  reply to an image with .nemotron <question>',

  async execute(sock, msg, args, extra) {
    const { from, reply } = extra;
    const query = args.join(' ').trim();

    const quoted    = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const quotedImg = quoted?.imageMessage;
    const urlMatch  = query.match(URL_RE);
    const urlInArgs = urlMatch ? urlMatch[0] : '';

    if (!query && !quotedImg) {
      return reply(
        `🎨 *NEMOTRON VL*\n\n` +
        `NVIDIA Nemotron Nano 12B VL — text + image understanding.\n\n` +
        `*Usage:*\n` +
        `  .nemotron <question>\n` +
        `  .nemotron <question> https://image.jpg\n` +
        `  Reply to an image with: .nemotron <question>`
      );
    }

    try {
      await sock.sendMessage(from, { react: { text: '🎨', key: msg.key } });

      let answer;

      if (quotedImg) {
        const buf = await downloadMediaMessage(
          { key: msg.key, message: quoted },
          'buffer',
          {},
          { reuploadRequest: sock.updateMediaMessage, logger: console }
        );
        if (!buf || buf.length === 0) throw new Error('Could not download the image from WhatsApp');

        answer = await vision(query || 'Describe this image in detail.', buf, {
          model: DEFAULT_MODEL, maxTokens: 2048, timeoutMs: 90000,
        });

      } else if (urlInArgs) {
        const promptOnly = query.replace(urlInArgs, '').trim() || 'Describe this image in detail.';
        answer = await vision(promptOnly, urlInArgs, {
          model: DEFAULT_MODEL, maxTokens: 2048, timeoutMs: 90000,
        });

      } else {
        answer = await chat(query, {
          model: DEFAULT_MODEL,
          system: `You are Nemotron, a helpful and concise AI assistant by NVIDIA. You are running inside the WhatsApp bot "${config.botName}".`,
          maxTokens: 2048,
          timeoutMs: 90000,
        });
      }

      // Strip <think> blocks (nemotron sometimes includes them)
      answer = String(answer).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      if (answer.length > 4000) answer = answer.substring(0, 4000) + '\n\n_...(truncated)_';

      await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });
      await sock.sendMessage(from, {
        text:
          `🎨 *NEMOTRON VL*\n` +
          `━━━━━━━━━━━━━━━━━\n` +
          `${answer}\n` +
          `━━━━━━━━━━━━━━━━━\n` +
          `> powered by *${getOwnerName()}*`,
      }, { quoted: msg });

    } catch (err) {
      console.error('[NEMOTRON] Error:', err.message);
      await sock.sendMessage(from, { react: { text: '❌', key: msg.key } });
      await reply(`❌ *Nemotron Error*\n\n${err.message}\n\nPlease try again.`);
    }
  },
};
