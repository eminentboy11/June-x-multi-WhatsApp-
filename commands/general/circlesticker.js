/**
 * Circle Sticker Command
 * Convert an image/video/sticker into a circle-cropped WhatsApp sticker.
 */

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { createCircleSticker } = require('../../utils/sticker');

// Max file size: 50MB
const MAX_FILE_SIZE = 50 * 1024 * 1024;

const getQuotedMessage = (message) =>
  message.message?.extendedTextMessage?.contextInfo?.quotedMessage ||
  message.message?.buttonsResponseMessage?.contextInfo?.quotedMessage ||
  message.message?.listResponseMessage?.contextInfo?.quotedMessage ||
  null;

const resolveMedia = (message) => {
  const messageType = Object.keys(message.message || {})[0];
  if (messageType === 'imageMessage' || messageType === 'stickerMessage' || messageType === 'videoMessage' || messageType === 'documentMessage') {
    return { type: messageType, media: message.message[messageType] };
  }
  const quoted = getQuotedMessage(message);
  if (!quoted) return null;
  const quotedType = Object.keys(quoted || {})[0];
  if (quotedType === 'imageMessage' || quotedType === 'stickerMessage' || quotedType === 'videoMessage' || quotedType === 'documentMessage') {
    return { type: quotedType, media: quoted[quotedType] };
  }
  return null;
};

module.exports = {
  name: 'circlesticker',
  aliases: ['circle', 'roundsticker'],
  description: 'Convert image/video/sticker into a circle-cropped WhatsApp sticker',
  usage: '.circlesticker (reply to sticker/image/video)',
  category: 'general',

  async execute(sock, msg, args, extra) {
    try {
      // The message that will be quoted in the reply
      const messageToQuote = msg;

      // The message object that contains the media to be downloaded
      let targetMessage = msg;

      // If the message is a reply, the target media is in the quoted message
      if (msg.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
        const quotedInfo = msg.message.extendedTextMessage.contextInfo;
        targetMessage = {
          key: {
            remoteJid: extra.from,
            id: quotedInfo.stanzaId,
            participant: quotedInfo.participant
          },
          message: quotedInfo.quotedMessage
        };
      }

      const mediaInfo = resolveMedia(targetMessage);

      if (!mediaInfo) {
        return extra.reply('⭕ Reply to a *sticker*, *image*, or *video* to convert it into a circle sticker.');
      }

      const { media: mediaMessage } = mediaInfo;

      if (!mediaMessage) {
        return extra.reply('⭕ Please reply to an image/video/sticker with .circlesticker, or send one with .circlesticker as the caption.');
      }

      // Download media
      const mediaBuffer = await downloadMediaMessage(
        targetMessage,
        'buffer',
        {},
        { logger: undefined, reuploadRequest: sock.updateMediaMessage }
      );

      if (!mediaBuffer) {
        return extra.reply('❌ Failed to download media. Please try again.');
      }

      // Check file size
      if (mediaBuffer.length > MAX_FILE_SIZE) {
        return extra.reply(`❌ File too large: ${(mediaBuffer.length / 1024 / 1024).toFixed(2)}MB (max: ${MAX_FILE_SIZE / 1024 / 1024}MB)`);
      }

      // Create the circle sticker
      const stickerBuffer = await createCircleSticker(mediaBuffer, {
        categories: ['⭕']
      });

      // Send the sticker
      await sock.sendMessage(extra.from, {
        sticker: stickerBuffer
      }, { quoted: messageToQuote });

    } catch (error) {
      console.error('CircleSticker command error:', error);
      await extra.reply('❌ Failed to create circle sticker! Try with an image or video.');
    }
  }
};
