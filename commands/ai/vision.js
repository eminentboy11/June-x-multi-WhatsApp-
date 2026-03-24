const { keithApi } = require('../../utils/keithApi');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const axios = require('axios');

module.exports = {
  name: 'vision',
  aliases: ['analyze', 'whatisthis'],
  category: 'ai',
  description: 'AI image analysis — reply to an image with a question',
  usage: '.vision <question> (reply to image)',

  async execute(sock, msg, args, extra) {
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const imgMsg = msg.message?.imageMessage || quoted?.imageMessage;

    if (!imgMsg) return extra.reply('❌ Reply to an image with a question.\n\nExample: Reply to a photo with *.vision What is in this image?*');

    await extra.react('👁️');
    try {
      const stream = await downloadContentFromMessage(imgMsg, 'image');
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);

      const form = new (require('form-data'))();
      form.append('file', buffer, { filename: 'image.jpg', contentType: 'image/jpeg' });
      const upload = await axios.post('https://tmpfiles.org/api/v1/upload', form, { headers: form.getHeaders() });
      const imageUrl = upload.data?.data?.url?.replace('tmpfiles.org/', 'tmpfiles.org/dl/') || '';

      if (!imageUrl) throw new Error('Failed to upload image');

      const question = args.join(' ') || 'What is in this image?';
      const data = await keithApi('/ai/vision', { image: imageUrl, q: question });
      await extra.reply(data.result || '❌ No analysis received.');
    } catch (e) {
      await extra.reply(`❌ Vision error: ${e.message}`);
    }
  }
};
