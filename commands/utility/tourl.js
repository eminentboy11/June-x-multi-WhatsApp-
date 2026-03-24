const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { sendButtons } = require('gifted-btns');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

async function uploadToCatbox(filePath, filename) {
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', fs.createReadStream(filePath), filename);
    const res = await axios.post('https://catbox.moe/user/api.php', form, {
        headers: form.getHeaders(),
        timeout: 120000,
    });
    const url = res.data?.trim();
    if (url && url.startsWith('http')) return url;
    throw new Error(url || `HTTP ${res.status}`);
}

async function uploadToUguu(filePath, filename) {
    const form = new FormData();
    form.append('files[]', fs.createReadStream(filePath), filename);
    const res = await axios.post('https://uguu.se/upload.php', form, {
        headers: form.getHeaders(),
        timeout: 60000,
    });
    const data = res.data;
    if (data.success && data.files?.[0]?.url) return data.files[0].url;
    throw new Error(data.description || 'No URL returned');
}

async function uploadToPomf(filePath, filename) {
    const form = new FormData();
    form.append('files[]', fs.createReadStream(filePath), filename);
    const res = await axios.post('https://pomf.lain.la/upload.php', form, {
        headers: form.getHeaders(),
        timeout: 60000,
    });
    const data = res.data;
    if (data.success && data.files?.[0]?.url) return `https://pomf.lain.la/${data.files[0].url}`;
    throw new Error('No URL returned');
}

async function uploadToFileio(filePath, filename) {
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath), filename);
    const res = await axios.post('https://file.io', form, {
        headers: form.getHeaders(),
        params: { expires: '1d' },
        timeout: 60000,
    });
    if (res.data.success) return res.data.link;
    throw new Error(res.data.message || 'Upload failed');
}

const UPLOAD_SERVICES = [
    { name: 'Catbox', fn: uploadToCatbox, supports: '*' },
    { name: 'Uguu', fn: uploadToUguu, supports: '*' },
    { name: 'Pomf', fn: uploadToPomf, supports: '*' },
    { name: 'File.io', fn: uploadToFileio, supports: '*' },
];

async function uploadWithFallback(filePath, filename) {
    const errors = [];
    for (const service of UPLOAD_SERVICES) {
        try {
            console.log(`[URL] Trying ${service.name}...`);
            const url = await service.fn(filePath, filename);
            if (url && typeof url === 'string' && url.startsWith('http')) {
                console.log(`[URL] Success via ${service.name}: ${url}`);
                return { url, service: service.name, success: true };
            }
        } catch (e) {
            console.log(`[URL] ${service.name} failed: ${e.message}`);
            errors.push(`${service.name}: ${e.message}`);
            await new Promise(r => setTimeout(r, 500));
        }
    }
    return { url: null, service: null, success: false, errors };
}

const MEDIA_HANDLERS = {
    imageMessage: { type: 'image', ext: '.jpg' },
    videoMessage: { type: 'video', ext: '.mp4' },
    audioMessage: { type: 'audio', ext: '.mp3' },
    documentMessage: { type: 'document', ext: null },
    stickerMessage: { type: 'sticker', ext: '.webp' },
};

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
                return { buffer, ext: fileExt, type: 'document', mime: messageContent.documentMessage.mimetype };
            }
            return { buffer, ext, type, mime: messageContent[key].mimetype };
        }
    }
    if (messageContent.documentWithCaptionMessage?.message?.documentMessage) {
        const doc = messageContent.documentWithCaptionMessage.message.documentMessage;
        const stream = await downloadContentFromMessage(doc, 'document');
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        const fileName = doc.fileName || 'file.bin';
        const fileExt = path.extname(fileName).toLowerCase() || '.bin';
        return { buffer: Buffer.concat(chunks), ext: fileExt, type: 'document', mime: doc.mimetype };
    }
    return null;
}

module.exports = {
    name: 'tourl',
    aliases: ['url', 'upload', 'tolink'],
    category: 'utility',
    description: 'Upload media to get a direct URL',
    usage: '.tourl (reply to media)',

    async execute(sock, msg, args, extra) {
        try {
            const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const directMsg = msg.message;

            let mediaContent = null;
            if (quoted) {
                mediaContent = quoted;
            } else if (directMsg) {
                mediaContent = directMsg;
            }

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

                const result = await uploadWithFallback(tempPath, filename);

                if (!result.success) {
                    await sock.sendMessage(extra.from, { react: { text: '❌', key: msg.key } });
                    let errText = '❌ Failed to convert media to URL.\n\n_Upload attempts:_\n';
                    result.errors.forEach((err, i) => { errText += `${i + 1}. ${err}\n`; });
                    return await sock.sendMessage(extra.from, { text: errText }, { quoted: msg });
                }

                await sock.sendMessage(extra.from, { react: { text: '✅', key: msg.key } });

                const responseText = `📎 *Media URL* 📎\n\n` +
                    `🔗 *Link:* ${result.url}\n` +
                    `📤 *Via:* ${result.service}\n` +
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
                                url: result.url
                            })
                        },
                        {
                            name: 'cta_copy',
                            buttonParamsJson: JSON.stringify({
                                display_text: '📋 Copy URL',
                                copy_code: result.url
                            })
                        }
                    ]
                }, { quoted: msg });

            } finally {
                setTimeout(() => {
                    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) {}
                }, 2000);
            }

        } catch (error) {
            console.error('[URL] error:', error?.message || error);
            await sock.sendMessage(extra.from, { react: { text: '❌', key: msg.key } });
            await sock.sendMessage(extra.from, { text: `❌ Error: ${error.message}` }, { quoted: msg });
        }
    }
};
