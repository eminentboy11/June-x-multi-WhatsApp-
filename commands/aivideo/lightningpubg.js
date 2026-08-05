const config = require('../../config');
const { generateEphoto, downloadMedia, sendGeneratedMedia } = require('./ephotoVideo');

const EFFECT_URLS = [
  'https://en.ephoto360.com/lightning-pubg-video-logo-maker-online-615.html',
  'https://en.ephoto360.com/create-pubg-style-glitch-video-avatar-581.html',
  'https://en.ephoto360.com/create-gaming-logo-pubg-style-online-free-575.html',
  'https://en.ephoto360.com/pubg-battlegrounds-logo-maker-online-free-576.html',
];

module.exports = {
  name: 'lightningpubg',
  aliases: ['pubgvideo', 'pubglightning', 'pubglogo', 'pubgintro', 'lightningpubgvideo'],
  category: 'aivideo',
  description: 'Create a lightning PUBG video logo with your text',
  usage: `${config.prefix || '.'}lightningpubg <text>`,

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
            text: `⚡ Lightning PUBG video\n\nUsage: ${prefix}lightningpubg <text>\nMaximum: 25 characters\nExample: ${prefix}lightningpubg ${config.botName || 'JUNE-X'}`,
          },
          { quoted: msg },
        );
      }

      if (text.length > 25) {
        return sock.sendMessage(jid, { text: '❌ Text is too long! Please use maximum 25 characters.' }, { quoted: msg });
      }

      let resultUrl = null;
      for (const effectUrl of EFFECT_URLS) {
        resultUrl = await generateEphoto(effectUrl, text);
        if (resultUrl) break;
      }

      if (!resultUrl) {
        return sock.sendMessage(
          jid,
          { text: `❌ Failed to generate lightning PUBG effect for "${text}". Please try again later.` },
          { quoted: msg },
        );
      }

      const media = await downloadMedia(resultUrl, 45000);
      await sendGeneratedMedia(sock, msg, media, {
        videoCaption: `⚡ *LIGHTNING PUBG VIDEO LOGO*\n📝 *Text:* ${text}`,
        imageCaption: `⚡ *LIGHTNING PUBG EFFECT*\n📝 *Text:* ${text}`,
      });
      await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } });
    } catch (error) {
      console.error('[LIGHTNINGPUBG] Error:', error);
      await sock.sendMessage(jid, { text: `❌ Error generating lightning PUBG video:\n${error.message}` }, { quoted: msg });
      await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } });
    }
  },
};