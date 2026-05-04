/**
 * GPT Image Vision Command
 * Analyze an image using GPT Vision via apiskeith.top
 */

const axios = require('axios');
const FormData = require('form-data');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { webp2png } = require(require('path').join(global.__CORE__, 'utils', 'webp2mp4'));
const Jimp = require('jimp');

module.exports = {
  name: 'gptimage',
  aliases: ['gptimg', 'aiimage', 'gi'],
  category: 'ai',
  description: 'Analyze an image using GPT Vision AI',
  usage: '.gptimage <question> (reply to image/sticker)',
  
  async execute(sock, msg, args, extra) {
    try {
      // Check if message is a reply
      const ctxInfo = msg.message?.extendedTextMessage?.contextInfo;
      if (!ctxInfo?.quotedMessage) {
        return await extra.reply(
          '📷 *GPT Image Editor*\n\n' +
          'Reply to an *image* or *sticker* with a prompt to edit it.\n\n' +
          `Usage: ${extra.prefix || '.'}gptimage <your prompt>\n\n` +
          'Example: Reply to an image with:\n' +
          `${extra.prefix || '.'}gptimage change the background to a beach`
        );
      }
      
      // Get prompt from args
      const prompt = args.join(' ').trim();
      if (!prompt) {
        return await extra.reply(
          '❌ Please provide a prompt!\n\n' +
          `Usage: ${extra.prefix || '.'}gptimage <your prompt>\n\n` +
          'Example: change the background to a beach'
        );
      }
      
      const targetMessage = {
        key: {
          remoteJid: extra.from,
          id: ctxInfo.stanzaId,
          participant: ctxInfo.participant,
        },
        message: ctxInfo.quotedMessage,
      };
      
      // Check if quoted message is an image or sticker
      const quotedMsg = ctxInfo.quotedMessage;
      const isImage = !!quotedMsg.imageMessage;
      const isSticker = !!quotedMsg.stickerMessage;
      
      if (!isImage && !isSticker) {
        return await extra.reply('❌ Please reply to an *image* or *sticker*!');
      }
      
      // Download media
      const mediaBuffer = await downloadMediaMessage(
        targetMessage,
        'buffer',
        {},
        { logger: undefined, reuploadRequest: sock.updateMediaMessage },
      );
      
      if (!mediaBuffer) {
        return await extra.reply('❌ Failed to download image. Please try again.');
      }
      
      // Convert sticker to image if needed
      let imageBuffer = mediaBuffer;
      if (isSticker) {
        const stickerMessage = quotedMsg.stickerMessage;
        const isAnimated = stickerMessage.isAnimated || stickerMessage.mimetype?.includes('animated');
        
        if (isAnimated) {
          return await extra.reply('❌ Animated stickers are not supported. Please use a static image or sticker.');
        }
        
        // Convert webp sticker to PNG
        try {
          imageBuffer = await webp2png(mediaBuffer);
        } catch (error) {
          console.error('Error converting sticker to PNG:', error);
          return await extra.reply('❌ Failed to convert sticker to image. Please try with a regular image.');
        }
      }
      
      // Convert to JPEG if needed (API might prefer JPEG)
      // Check if it's already JPEG, if not convert
      let finalImageBuffer = imageBuffer;
      try {
        const image = await Jimp.read(imageBuffer);
        if (image.getMIME() !== Jimp.MIME_JPEG) {
          finalImageBuffer = await image.quality(90).getBufferAsync(Jimp.MIME_JPEG);
        }
      } catch (error) {
        console.error('Error processing image with jimp:', error);
        finalImageBuffer = imageBuffer;
      }
      
      // Upload image to tmpfiles.org to get a public URL
      const uploadForm = new FormData();
      uploadForm.append('file', finalImageBuffer, { filename: 'image.jpg', contentType: 'image/jpeg' });
      const upload = await axios.post('https://tmpfiles.org/api/v1/upload', uploadForm, {
        headers: uploadForm.getHeaders(),
        timeout: 30000
      });
      const imageUrl = upload.data?.data?.url?.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
      if (!imageUrl) throw new Error('Failed to upload image for analysis');

      // Call apiskeith.top vision endpoint
      const question = prompt || 'What is in this image?';
      const { data } = await axios.get('https://apiskeith.top/ai/vision', {
        params: { image: imageUrl, q: question },
        timeout: 60000
      });

      const answer = data.result || '❌ No analysis received.';

      await sock.sendMessage(extra.from, {
        text: `👁️ *GPT Vision Analysis*\n\n📝 *Question:* ${question}\n\n${answer}`
      }, { quoted: msg });
      
    } catch (error) {
      console.error('Error in gptimage command:', error);
      
      if (error.response) {
        // API error
        const status = error.response.status;
        if (status === 400) {
          return await extra.reply('❌ Bad Request: Invalid parameters. Please check your prompt and image.');
        } else if (status === 429) {
          return await extra.reply('❌ Rate limit exceeded. Please try again later.');
        } else if (status === 500) {
          return await extra.reply('❌ Server error. Please try again later.');
        }
      }
      
      if (error.code === 'ECONNABORTED') {
        return await extra.reply('❌ Request timeout. The image processing took too long. Please try again.');
      }
      
      return await extra.reply(`❌ Error: ${error.message || 'Unknown error occurred'}`);
    }
  },
};

