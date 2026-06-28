const axios = require('axios');

module.exports = {
  name: 'enhance',
  aliases: ['colorenhance', 'upscale'],
  category: 'tools',
  description: 'Enhance and colorize an image using AI',
  usage: '.enhance (reply to an image)',

  async execute(sock, msg, args, extra) {
    await extra.react('🎨');
    try {
      const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      const imageMsg =
        quoted?.imageMessage ||
        msg.message?.imageMessage;

      if (!imageMsg) {
        return extra.reply('❌ Please reply to an image to enhance it.');
      }

      await extra.reply('🎨 Enhancing your image, please wait...');

      const { downloadMediaMessage } = require('@whiskeysockets/baileys');
      const buffer = await downloadMediaMessage(
        {
          key: msg.message?.extendedTextMessage?.contextInfo?.stanzaId
            ? { ...msg.key, id: msg.message.extendedTextMessage.contextInfo.stanzaId }
            : msg.key,
          message: quoted || msg.message,
        },
        'buffer',
        {},
        { logger: console, reuploadRequest: sock.updateMediaMessage }
      );

      // Upload to Uguu.se (48hr temporary hosting)
      const FormData = require('form-data');
      const form = new FormData();
      form.append('files[]', buffer, { filename: 'image.jpg', contentType: 'image/jpeg' });

      const upload = await axios.post('https://uguu.se/upload', form, {
        headers: form.getHeaders(),
      });

      const imageUrl = upload.data?.files?.[0]?.url;
      if (!imageUrl) throw new Error('Image upload to Uguu failed.');

      // Call Shizo enhance API
      const { data } = await axios.get(
        `https://api.shizo.top/ai/enhance?apikey=shizo&url=${encodeURIComponent(imageUrl)}`
      );

      if (!data.status || !data.result) {
        throw new Error('Enhancement failed. No result returned.');
      }

      await sock.sendMessage(
        msg.key.remoteJid,
        {
          image: { url: data.result },
          caption: '✨ *AI Enhanced Image*\n\n_Powered by Shizo AI_',
        },
        { quoted: msg }
      );

      await extra.react('✅');
    } catch (e) {
      await extra.react('❌');
      await extra.reply(`❌ Error: ${e.message}`);
    }
  }
};
