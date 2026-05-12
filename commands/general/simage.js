/**
 * Sticker to Image - Convert sticker to PNG image
 */

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { webp2png } = require('../../utils/webp2mp4');

module.exports = {
  name: 'simage',
  aliases: ['toimg', 'stickertoimg', 'sticker2img', 'svideo'],
  category: 'general',
  description: 'Convert sticker to image (PNG)',
  usage: '.simage (reply to sticker)',
  
  async execute(sock, msg, args, extra) {
    try {
      const notStickerMessage = '📎 Reply to a sticker to convert it to image!';
      
      // Check if message is a reply
      const ctxInfo = msg.message?.extendedTextMessage?.contextInfo;
      if (!ctxInfo?.quotedMessage) {
        return await extra.reply(notStickerMessage);
      }
      
      const targetMessage = {
        key: {
          remoteJid: extra.from,
          id: ctxInfo.stanzaId,
          participant: ctxInfo.participant,
        },
        message: ctxInfo.quotedMessage,
      };
      
      // Check if quoted message is a sticker
      const stickerMessage = targetMessage.message?.stickerMessage;
      if (!stickerMessage) {
        return await extra.reply(notStickerMessage);
      }
      
      // Download sticker
      const stickerBuffer = await downloadMediaMessage(
        targetMessage,
        'buffer',
        {},
        { logger: undefined, reuploadRequest: sock.updateMediaMessage },
      );
      
      if (!stickerBuffer) {
        return await extra.reply('❌ Failed to download sticker. Please try again.');
      }
      
      // Detect animated sticker — check flag OR sniff the WebP bytes for ANIM chunk
      let isAnimated = !!(stickerMessage.isAnimated);
      if (!isAnimated) {
        // ANIM chunk marker in animated WebP: bytes 12-15 = 0x41 0x4E 0x49 0x4D ("ANIM")
        // ANMF chunk marker: 0x41 0x4E 0x4D 0x46 ("ANMF")
        const hex = stickerBuffer.toString('hex');
        isAnimated = hex.includes('414e494d') || hex.includes('414e4d46');
      }

      if (isAnimated) {
        // Animated sticker → MP4 (FFmpeg decodes animated WebP natively)
        const { webp2mp4 } = require('../../utils/webp2mp4');
        const mp4Buffer = await webp2mp4(stickerBuffer);
        if (!mp4Buffer || mp4Buffer.length === 0) throw new Error('MP4 buffer is empty');
        await sock.sendMessage(extra.from, {
          video: mp4Buffer,
          mimetype: 'video/mp4',
          gifPlayback: true
        }, { quoted: msg });
      } else {
        // Static sticker → PNG (FFmpeg grabs first frame)
        const imageBuffer = await webp2png(stickerBuffer);
        await sock.sendMessage(extra.from, {
          image: imageBuffer
        }, { quoted: msg });
      }
      
    } catch (error) {
      console.error('Error in simage command:', error);
      await extra.reply(`❌ Failed to convert sticker to image.\n\nError: ${error.message}`);
    }
  }
};

