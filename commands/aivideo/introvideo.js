const config = require('../../config');
const { generateEphoto, downloadMedia, sendGeneratedMedia } = require('./ephotoVideo');

const EFFECT_URLS = [
  'https://en.ephoto360.com/free-logo-intro-video-maker-online-558.html',
  'https://en.ephoto360.com/free-logo-intro-video-maker-online-582.html',
  'https://en.ephoto360.com/create-digital-glitch-text-effect-online-772.html',
];

module.exports = {
  name: 'introvideo',
  aliases: ['intro', 'logointro', 'introanimation', 'videointro'],
  category: 'aivideo',
  description: 'Create a logo intro video with your text',
  usage: `${config.prefix || '.'}introvideo <text>`,

  async execute(sock, msg, args, extra = {}) {
    const jid = msg.key.remoteJid;
    const prefix = extra.prefix || config.prefix || '.';
    await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } });

    try {
      const text = args.join(' ').trim();
      if (!text) {
        return sock.sendMessage(
          jid,
          {
            text: `🎬 Logo intro video\n\nUsage: ${prefix}introvideo <text>\nMaximum: 30 characters\nExample: ${prefix}introvideo ${config.botName || 'JUNE-X'}`,
          },
          { quoted: msg },
        );
      }

      if (text.length > 30) {
        return sock.sendMessage(jid, { text: '❌ Text is too long! Please use maximum 30 characters.' }, { quoted: msg });
      }

      let resultUrl = null;
      for (const effectUrl of EFFECT_URLS) {
        resultUrl = await generateEphoto(effectUrl, text);
        if (resultUrl) break;
      }

      if (!resultUrl) {
        return sock.sendMessage(
          jid,
          { text: `❌ Failed to generate intro video for "${text}". Please try again later.` },
          { quoted: msg },
        );
      }

      const media = await downloadMedia(resultUrl, 45000);
      await sendGeneratedMedia(sock, msg, media, {
        videoCaption: `🎬 *LOGO INTRO VIDEO*\n📝 *Text:* ${text}`,
        imageCaption: `🎬 *LOGO INTRO EFFECT*\n📝 *Text:* ${text}`,
      });
      await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } });
    } catch (error) {
      console.error('[INTROVIDEO] Error:', error);
      await sock.sendMessage(jid, { text: `❌ Error generating intro video:\n${error.message}` }, { quoted: msg });
      await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } });
    }
  },
};