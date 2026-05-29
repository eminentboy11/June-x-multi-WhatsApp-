/**
 * Catbox Command
 * Upload any file to catbox.moe via URL or quoted media (permanent hosting)
 */

const axios = require('axios');
const FormData = require('form-data');
const { sendButtons } = require('gifted-btns');
const config = require('../../config');

// Baileys helper
const { downloadMediaMessage } = require('@whiskeysockets/baileys');

module.exports = {
    name: 'catbox',
    aliases: ['cbox', 'host'],
    category: 'tools',
    description: 'Upload a file to catbox.moe via URL or quoted media (permanent hosting)',
    usage: '.catbox <file-url> or reply to media',

    async execute(sock, msg, args, extra) {
        try {
            await sock.sendMessage(extra.from, { react: { text: '⏳', key: msg.key } });

            let fileBuffer, fileName, contentType, fileSizeKB;

            // ─── MODE 1: Quoted Media ───────────────────────────────
            const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (quoted) {
                const mediaType =
                    quoted.imageMessage     ? 'imageMessage'     :
                    quoted.videoMessage     ? 'videoMessage'     :
                    quoted.audioMessage     ? 'audioMessage'     :
                    quoted.documentMessage  ? 'documentMessage'  :
                    quoted.stickerMessage   ? 'stickerMessage'   :
                    null;

                if (!mediaType) return extra.reply('❌ Quoted message has no supported media!');

                const mediaMsg = quoted[mediaType];
                const fakeMsg = {
                    key: msg.message.extendedTextMessage.contextInfo.stanzaId
                        ? { ...msg.key, id: msg.message.extendedTextMessage.contextInfo.stanzaId }
                        : msg.key,
                    message: quoted
                };

                // Use Baileys downloadMediaMessage
                fileBuffer = await downloadMediaMessage(fakeMsg, 'buffer', {}, { logger: sock.logger });
                contentType = mediaMsg.mimetype || 'application/octet-stream';
                const ext = contentType.split('/')[1]?.split(';')[0] || 'bin';
                fileName = mediaMsg.fileName || `upload_${Date.now()}.${ext}`;
                fileSizeKB = (fileBuffer.byteLength / 1024).toFixed(1);

            // ─── MODE 2: URL Argument ───────────────────────────────
            } else {
                const url = args.join(' ').trim();
                if (!url) return extra.reply(
                    '❌ Please provide a file URL or reply to a media message!\nExample:\n.catbox https://example.com/image.png'
                );

                const fileResponse = await axios.get(url, {
                    responseType: 'arraybuffer',
                    timeout: 30000,
                    maxContentLength: 200 * 1024 * 1024 // 200MB limit
                });

                const contentDisposition = fileResponse.headers['content-disposition'];
                if (contentDisposition) {
                    const match = contentDisposition.match(/filename="?([^";\n]+)"?/);
                    if (match) fileName = match[1].trim();
                }
                if (!fileName) {
                    const urlPath = url.split('?')[0];
                    fileName = urlPath.split('/').pop() || `upload_${Date.now()}`;
                }

                contentType = fileResponse.headers['content-type'] || 'application/octet-stream';
                fileBuffer = Buffer.from(fileResponse.data);
                fileSizeKB = (fileBuffer.byteLength / 1024).toFixed(1);
            }

            // ─── Upload to Catbox.moe ───────────────────────────────
            const form = new FormData();
            form.append('reqtype', 'fileupload');
            form.append('fileToUpload', fileBuffer, {
                filename: fileName,
                contentType: contentType
            });

            const { data: hostedUrl } = await axios.post(
                'https://catbox.moe/user/api.php',
                form,
                {
                    headers: {
                        ...form.getHeaders(),
                        'User-Agent': 'Mozilla/5.0'
                    },
                    timeout: 60000
                }
            );

            if (!hostedUrl || !hostedUrl.startsWith('https://')) {
                throw new Error('Upload failed or was rejected by Catbox');
            }

            await sock.sendMessage(extra.from, { react: { text: '✅', key: msg.key } });

            const hostedName = hostedUrl.split('/').pop();
            const responseText =
                ` *📦 File Hosted on Catbox*\n\n` +
                ` *File:* ${hostedName}\n` +
                ` *Size:* ${fileSizeKB} KB\n` +
                ` *Hosted:* ${hostedUrl}\n\n` +
                ` ♾️ _This link is permanent_`;

            await sendButtons(sock, extra.from, {
                text: responseText,
                footer: `> Powered by ${config.botName}`,
                buttons: [
                    {
                        name: 'cta_url',
                        buttonParamsJson: JSON.stringify({
                            display_text: '🌐 Open File',
                            url: hostedUrl
                        })
                    },
                    {
                        name: 'cta_copy',
                        buttonParamsJson: JSON.stringify({
                            display_text: '📋 Copy Link',
                            copy_code: hostedUrl
                        })
                    }
                ]
            }, { quoted: msg });

        } catch (error) {
            console.error('CATBOX ERROR:', error);
            await sock.sendMessage(extra.from, { react: { text: '❌', key: msg.key } });

            let errMsg = '❌ Failed to upload to Catbox: ';
            if (error.code === 'ECONNABORTED') errMsg += 'Request timed out (file may be too large)';
            else if (error.code === 'ERR_FR_MAX_BODY_LENGTH_EXCEEDED') errMsg += 'File exceeds the 200MB limit';
            else errMsg += (error.message || 'Unknown error');

            await extra.reply(errMsg);
        }
    }
};
