/**
 * Uguu Command
 * Upload any file to uguu.se via URL (temporary hosting, ~48hrs)
 */

const axios = require('axios');
const FormData = require('form-data');
const { sendButtons } = require('gifted-btns');
const config = require('../../config');

module.exports = {
    name: 'uguu',
    aliases: ['temp', 'temphost'],
    category: 'tools',
    description: 'Upload a file to uguu.se via URL (temporary ~48hr hosting)',
    usage: '.uguu <file-url>',

    async execute(sock, msg, args, extra) {
        try {
            const url = args.join(' ').trim();
            if (!url) return extra.reply(
                '❌ Please provide a file URL to upload!\nExample:\n.uguu https://example.com/image.png'
            );

            await sock.sendMessage(extra.from, { react: { text: '⏳', key: msg.key } });

            // Step 1: Download the file as a buffer
            const fileResponse = await axios.get(url, {
                responseType: 'arraybuffer',
                timeout: 30000,
                maxContentLength: 100 * 1024 * 1024 // 100MB limit
            });

            // Extract filename from URL or Content-Disposition header
            const contentDisposition = fileResponse.headers['content-disposition'];
            let fileName = 'file';

            if (contentDisposition) {
                const match = contentDisposition.match(/filename="?([^";\n]+)"?/);
                if (match) fileName = match[1].trim();
            } else {
                const urlPath = url.split('?')[0]; // strip query params
                fileName = urlPath.split('/').pop() || 'file';
            }

            const contentType = fileResponse.headers['content-type'] || 'application/octet-stream';
            const fileSizeKB = (fileResponse.data.byteLength / 1024).toFixed(1);

            // Step 2: Upload buffer to uguu.se
            const form = new FormData();
            form.append('files[]', Buffer.from(fileResponse.data), {
                filename: fileName,
                contentType: contentType
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
                ` *Source:* ${url}\n` +
                ` *Hosted:* ${hostedUrl}\n` +
                ` *File:* ${hostedName}\n` +
                ` *Size:* ${fileSizeKB} KB\n\n` +
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
