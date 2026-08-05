const config = require('../../config');
const { generateEphoto, downloadMedia, sendGeneratedMedia } = require('./ephotoVideo');

const EFFECT_URLS = [
  'https://en.ephoto360.com/create-sweet-love-video-cards-online-734.html',
  'https://en.ephoto360.com/create-romantic-luxury-video-wedding-invitations-online-580.html',
  'https://en.ephoto360.com/write-text-on-love-hearts-261.html',
  'https://en.ephoto360.com/love-hearts-name-generator-353.html',
];

module.exports = {
  name: 'lovevideo',
  aliases: ['lovecard', 'sweetlove', 'loveanimation', 'lovegreeting', 'romanticvideo'],
  category: 'aivideo',
  description: 'Create a sweet love video card with your text',
  usage: `${config.prefix || '.'}lovevideo <text>`,

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
            text: `💖 Love video card\n\nUsage: ${prefix}lovevideo <text>\nMaximum: 50 characters\nExample: ${prefix}lovevideo I love ${config.botName || 'you'}`,
          },
          { quoted: msg },
        );
      }
      if (text.length > 50) {
        return sock.sendMessage(jid, { text: '❌ Text is too long! Please use maximum 50 characters.' }, { quoted: msg });
      }

      let resultUrl = null;
      for (const effectUrl of EFFECT_URLS) {
        resultUrl = await generateEphoto(effectUrl, text);
        if (resultUrl) break;
      }
      if (!resultUrl) {
        return sock.sendMessage(jid, { text: `❌ Failed to generate love video for "${text}". Please try again later.` }, { quoted: msg });
      }

      const media = await downloadMedia(resultUrl, 45000);
      await sendGeneratedMedia(sock, msg, media, {
        videoCaption: `💖 *SWEET LOVE VIDEO CARD*\n📝 *Message:* ${text}`,
        imageCaption: `💖 *SWEET LOVE CARD*\n📝 *Message:* ${text}`,
      });
      await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } });
    } catch (error) {
      console.error('[LOVEVIDEO] Error:', error);
      await sock.sendMessage(jid, { text: `❌ Error generating love video:\n${error.message}` }, { quoted: msg });
      await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } });
    }
  },
};