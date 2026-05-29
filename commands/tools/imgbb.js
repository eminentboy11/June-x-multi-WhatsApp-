const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { sendButtons } = require('gifted-btns');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

// === Upload to ImgBB ===
async function uploadToImgBB(filePath, filename) {
    const buffer = await fs.promises.readFile(filePath);
    const form = new FormData();
    form.append('image', buffer.toString('base64'));

    const apiKey = process.env.IMGBB_API_KEY || '041e0067533623124cf24d5f1f1c7a71';
    if (!apiKey) throw new Error('IMGBB_API_KEY not set');

    const res = await axios.post(`https://api.imgbb.com/1/upload?key=${apiKey}`, form, {
        headers: form.getHeaders(),
        timeout: 60000,
    });

    const url = res.data?.data?.url;
    if (url && url.startsWith('http')) return url;
    throw new Error('ImgBB: no URL in response');
}

// === Media Handlers ===
const MEDIA_HANDLERS = {
    imageMessage: { type: 'image', ext: '.jpg' },
    videoMessage: { type: 'video', ext: '.mp4' },
    audioMessage: { type: 'audio', ext: '.mp3' },
    documentMessage: { type: 'document', ext: null },
    stickerMessage: { type: 'sticker', ext: '.webp' },
};

// === Extract Media ===
async function extractMedia(messageContent) {
    for (const key in MEDIA_HANDLERS) {
        if (messageContent[key]) {
            const { type, ext } = MEDIA_HANDLERS[key];
            const stream = await downloadContentFromMessage(messageContent[key], type);
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            const buffer = Buffer.concat(chunks);

            if (key === 'documentMessage') {
                const fileName = messageContent.documentMessage.fileName || 'file.bin';
                const fileExt = path.extname(fileName).toLowerCase() || '.bin';
                return {
                    buffer,
                    ext: fileExt,
                    type: 'document',
                    mime: messageContent.documentMessage.mimetype
                };
            }
            return { buffer, ext, type, mime: messageContent[key].mimetype };
        }
    }

    // Handle documentWithCaptionMessage
    if (messageContent.documentWithCaptionMessage?.message?.documentMessage) {
        const doc = messageContent.documentWithCaptionMessage.message.documentMessage;
        const stream = await downloadContentFromMessage(doc, 'document');
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        const fileName = doc.fileName || 'file.bin';
        const fileExt = path.extname(fileName).toLowerCase() || '.bin';
        return {
            buffer: Buffer.concat(chunks),
            ext: fileExt,
            type: 'document',
            mime: doc.mimetype
        };
    }

    return null;
}

// === Command Export ===
module.exports = {
    name: 'imgbb',
    aliases: ['url', 'imgbb', 'tolink'],
    category: 'tools',
    description: 'Upload media to get a direct URL (uses ImgBB only)',
    usage: '.tourl (reply to media)',

    async execute(sock, msg, args, extra) {
        try {
            const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const directMsg = msg.message;

            const mediaContent = quoted || directMsg;
            if (!mediaContent) {
                return extra.reply('📎 Send or reply to a media (image, video, audio, sticker, document) to get a URL.');
            }

            const media = await extractMedia(mediaContent);
            if (!media) {
                return extra.reply('📎 Send or reply to a media (image, video, audio, sticker, document) to get a URL.');
            }

            await sock.sendMessage(extra.from, { react: { text: '🔄', key: msg.key } });

            const tempDir = path.join(__dirname, '../../temp');
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

            const tempPath = path.join(tempDir, `${Date.now()}${media.ext}`);
            fs.writeFileSync(tempPath, media.buffer);

            const sizeMB = (media.buffer.length / 1024 / 1024).toFixed(2);
            const filename = `file${media.ext}`;

            try {
                await sock.sendMessage(extra.from, { react: { text: '⏫', key: msg.key } });

                const url = await uploadToImgBB(tempPath, filename);

                await sock.sendMessage(extra.from, { react: { text: '✅', key: msg.key } });

                const responseText = `📎 *Media URL* 📎\n\n` +
                    `🔗 *Link:* ${url}\n` +
                    `📤 *Via:* ImgBB\n` +
                    `📁 *Type:* ${media.type}\n` +
                    `📦 *Size:* ${sizeMB} MB`;

                await sendButtons(sock, extra.from, {
                    text: responseText,
                    footer: `> Powered by ${require('../../config').botName}`,
                    buttons: [
                        {
                            name: 'cta_url',
                            buttonParamsJson: JSON.stringify({
                                display_text: '🔗 Open Link',
                                url
                            })
                        },
                        {
                            name: 'cta_copy',
                            buttonParamsJson: JSON.stringify({
                                display_text: '📋 Copy URL',
                                copy_code: url
                            })
                        }
                    ]
                }, { quoted: msg });

            } catch (uploadError) {
                await sock.sendMessage(extra.from, { react: { text: '❌', key: msg.key } });
                console.error('[ImgBB Upload Error]', uploadError.message);
                await sock.sendMessage(extra.from, { text: `❌ Upload failed: ${uploadError.message}` }, { quoted: msg });
            } finally {
                setTimeout(() => {
                    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) {}
                }, 2000);
            }

        } catch (error) {
            console.error('[tourl Error]', error?.message || error);
            await sock.sendMessage(extra.from, { react: { text: '❌', key: msg.key } });
            await sock.sendMessage(extra.from, { text: `❌ Error: ${error.message}` }, { quoted: msg });
        }
    }
};
