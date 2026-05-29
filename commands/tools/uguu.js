/**
 * Uguu Command
 * Upload any file to uguu.se via URL or quoted media (temporary hosting, ~48hrs)
 */

const axios = require('axios');
const FormData = require('form-data');
const { sendButtons } = require('gifted-btns');
const { downloadMediaMessage } = require('@whiskeysockets/baileys'); // ✅ Added import
const config = require('../../config');

module.exports = {
    name: 'uguu',
    aliases: ['temp', 'temphost'],
    category: 'tools',
    description: 'Upload a file to uguu.se via URL or quoted media (temporary ~48hr hosting)',
    usage: '.uguu <file-url> or reply to media',

    async execute(sock, msg, args, extra) {
        try {
            await sock.sendMessage(extra.from, { react: { text: '⏳', key: msg.key } });

            let fileBuffer, fileName, contentType, fileSizeKB;

            // ─── MODE 1: Quoted Media ───────────────────────────────────────
            const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

            if (quoted) {
                const mediaType =
                    quoted.imageMessage    ? 'imageMessage'    :
                    quoted.videoMessage    ? 'videoMessage'    :
                    quoted.audioMessage    ? 'audioMessage'    :
                    quoted.documentMessage ? 'documentMessage' :
                    quoted.stickerMessage  ? 'stickerMessage'  :
                    null;

                if (!mediaType) {
                    return extra.reply('❌ Quoted message has no supported media!');
                }

                const mediaMsg = quoted[mediaType];

                // Build a fake message object for downloadMediaMessage
                const fakeMsg = {
                    key: { ...msg.key },
                    message: quoted
                };

                fileBuffer = await downloadMediaMessage(fakeMsg, 'buffer', {}, { logger: undefined });

                contentType = mediaMsg.mimetype || 'application/octet-stream';
                const ext = contentType.split('/')[1]?.split(';')[0] || 'bin';
                fileName = mediaMsg.fileName || `upload_${Date.now()}.${ext}`;
                fileSizeKB = (fileBuffer.byteLength / 1024).toFixed(1);

            // ─── MODE 2: URL Argument ───────────────────────────────────────
            } else {
                const url = args.join(' ').trim();
                if (!url) {
                    return extra.reply(
                        '❌ Please provide a file URL or reply to a media message!\nExample:\n.uguu https://example.com/image.png'
                    );
                }

                const fileResponse = await axios.get(url, {
                    responseType: 'arraybuffer',
                    timeout: 30000,
                    maxBodyLength: 100 * 1024 * 1024
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

            // ─── Upload to Uguu.se ──────────────────────────────────────────
            const form = new FormData();
            form.append('files[]', fileBuffer, {
                filename: fileName,
                contentType
            });

            const { data: uguuRes } = await axios.post(
                'https://uguu.se/upload.php',
                form,
                {
                    headers: {
                        ...form.getHeaders(),
                        'User-Agent': 'Mozilla/5.0'
                    },
                    timeout: 60000
                }
            );

            if (!uguuRes?.success || !uguuRes?.files?.length) {
                throw new Error('Uguu returned an invalid response');
            }

            const hostedUrl = uguuRes.files[0].url;
            const hostedName = uguuRes.files[0].name;

            await sock.sendMessage(extra.from, { react: { text: '✅', key: msg.key } });

            const responseText =
                ` *⏱️ File Hosted on Uguu.se*\n\n` +
                ` *File:* ${hostedName}\n` +
                ` *Size:* ${fileSizeKB} KB\n` +
                ` *Hosted:* ${hostedUrl}\n\n` +
                ` ⚠️ _This link expires in ~48 hours_`;

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
            console.error('UGUU ERROR:', error);
            await sock.sendMessage(extra.from, { react: { text: '❌', key: msg.key } });

            let errMsg = '❌ Failed to upload to Uguu: ';
            if (error.code === 'ECONNABORTED') errMsg += 'Request timed out (file may be too large)';
            else if (error.response?.status === 413) errMsg += 'File is too large for Uguu';
            else errMsg += (error.message || error);

            await extra.reply(errMsg);
        }
    }
};
