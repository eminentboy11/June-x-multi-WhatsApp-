const { keithApi } = require('../../utils/keithApi');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const axios = require('axios');

module.exports = {
  name: 'shazam',
  aliases: ['songfinder', 'findsong'],
  category: 'ai',
  description: 'Identify a song from audio — reply to audio/voice message',
  usage: '.shazam (reply to audio)',

  async execute(sock, msg, args, extra) {
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const audioMsg = msg.message?.audioMessage || quoted?.audioMessage;

    if (!audioMsg) return extra.reply('❌ Reply to an audio/voice message to identify the song.');

    await extra.react('🎵');
    try {
      const stream = await downloadContentFromMessage(audioMsg, 'audio');
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);

      const form = new (require('form-data'))();
      form.append('file', buffer, { filename: 'audio.m4a', contentType: 'audio/mp4' });
      const upload = await axios.post('https://tmpfiles.org/api/v1/upload', form, { headers: form.getHeaders() });
      const audioUrl = upload.data?.data?.url?.replace('tmpfiles.org/', 'tmpfiles.org/dl/') || '';

      if (!audioUrl) throw new Error('Failed to upload audio');

      const data = await keithApi('/ai/shazam', { url: audioUrl });
      const r = data.result || data;
      let text = '🎵 *Song Found!*\n\n';
      text += `🎤 *Title:* ${r.title || r.name || 'Unknown'}\n`;
      text += `👤 *Artist:* ${r.artist || r.author || 'Unknown'}\n`;
      if (r.album) text += `💿 *Album:* ${r.album}\n`;
      await extra.reply(text);
    } catch (e) {
      await extra.reply(`❌ Shazam error: ${e.message}`);
    }
  }
};
