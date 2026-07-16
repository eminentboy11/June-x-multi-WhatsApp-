/**
 * Sticker to Image / Video - Convert sticker to PNG image or MP4 video
 * Works both when replying to a sticker AND when sending a sticker directly
 * with .toimage / .toimg as the caption.
 */

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { webp2png, webp2mp4 } = require('../../utils/webp2mp4');

module.exports = {
  name: 'simage',
  aliases: ['toimg', 'toimage', 'stickertoimg', 'sticker2img', 'svideo'],
  category: 'general',
  description: 'Convert sticker to image (PNG) or animated sticker to video (MP4)',
  usage: '.toimage (reply to sticker, or send sticker with .toimage as caption)',

  async execute(sock, msg, args, extra) {
    try {
      let targetMessage = null;
      let stickerMessage = null;

      // ── 1. Direct sticker send: user sent the sticker with .toimage as caption ──
      if (msg.message?.stickerMessage) {
        targetMessage = msg;
        stickerMessage = msg.message.stickerMessage;
      }

      // ── 2. Reply to a sticker ────────────────────────────────────────────────
      if (!stickerMessage) {
        const ctxInfo = msg.message?.extendedTextMessage?.contextInfo;
        if (ctxInfo?.quotedMessage?.stickerMessage) {
          targetMessage = {
            key: {
              remoteJid: msg.key.remoteJid,
              fromMe: false,
              id: ctxInfo.stanzaId,
              participant: ctxInfo.participant,
            },
            message: ctxInfo.quotedMessage,
          };
          stickerMessage = ctxInfo.quotedMessage.stickerMessage;
        }
      }

      if (!stickerMessage || !targetMessage) {
        return await extra.reply('📎 Send a sticker with *.toimage* as caption, or reply to a sticker with *.toimage*');
      }

      // Download sticker
      const stickerBuffer = await downloadMediaMessage(
        targetMessage,
        'buffer',
        {},
        { logger: undefined, reuploadRequest: sock.updateMediaMessage },
      );

      if (!stickerBuffer || stickerBuffer.length === 0) {
        return await extra.reply('❌ Failed to download sticker. Please try again.');
      }

      // Animated detection — check isAnimated flag (Baileys sets this reliably)
      const isAnimated = stickerMessage.isAnimated === true;

      if (isAnimated) {
        // Animated sticker → MP4 video
        const mp4Buffer = await webp2mp4(stickerBuffer);

        if (!mp4Buffer || mp4Buffer.length === 0) {
          throw new Error('MP4 conversion returned empty output');
        }

        const maxSize = 16 * 1024 * 1024;
        if (mp4Buffer.length > maxSize) {
          throw new Error(`MP4 too large: ${(mp4Buffer.length / 1024 / 1024).toFixed(2)}MB`);
        }

        await sock.sendMessage(extra.from, {
          video: mp4Buffer,
          mimetype: 'video/mp4',
          gifPlayback: true,
        }, { quoted: msg });

      } else {
        // Static sticker → PNG image
        const imageBuffer = await webp2png(stickerBuffer);
        await sock.sendMessage(extra.from, { image: imageBuffer }, { quoted: msg });
      }

    } catch (error) {
      console.error('Error in simage/toimage command:', error);
      await extra.reply(`❌ Failed to convert sticker.\n\nError: ${error.message}`);
    }
  }
};
