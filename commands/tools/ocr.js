/**
 * OCR Command
 * Extract text from an image using OCR
 */

const axios = require('axios');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

module.exports = {
    name: 'ocr',
    aliases: ['readtext'],
    category: 'tools',
    description: 'Extract text from an image',
    usage: '.ocr (reply to an image)',

    async execute(sock, msg, args, extra) {
        try {
            const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const imageMsg = quotedMsg?.imageMessage || msg.message?.imageMessage;

            if (!imageMsg) return extra.reply('⚠️ Send or reply to an *image* with the caption *.ocr* to extract text.');
            if (!/image/.test(imageMsg.mimetype || '')) return extra.reply('⚠️ This command only works with *images*!');

            await sock.sendMessage(extra.from, { react: { text: '⏳', key: msg.key } });

            const stream = await downloadContentFromMessage(imageMsg, 'image');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

            const mimeType = /png/.test(imageMsg.mimetype) ? 'image/png' : 'image/jpeg';
            const imageBase64 = buffer.toString('base64');

            const res = await axios.post(
                'https://staging-ai-image-ocr-266i.frontend.encr.app/api/ocr/process',
                { imageBase64, mimeType },
                { headers: { 'content-type': 'application/json' } }
            );

            const text = res.data.extractedText?.trim() || '❌ No text detected in the image.';
            await extra.reply(`📄 *Extracted Text:*\n\n${text}`);
            await sock.sendMessage(extra.from, { react: { text: '✅', key: msg.key } });
        } catch (error) {
            console.error('OCR Error:', error);
            await extra.reply('💥 Failed to read text from image. Please try again later.');
            await sock.sendMessage(extra.from, { react: { text: '❌', key: msg.key } });
        }
    }
};
