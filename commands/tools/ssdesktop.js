/**
 * SSCapture Command
 * Screenshots a website using snapshot.xwolf.space
 */

const axios = require('axios');
const config = require('../../config');

const API_BASE = 'https://snapshot.xwolf.space/api/capture';
const VIEWPORTS = ['desktop', 'mobile'];

module.exports = {
    name: 'ssdsktp',
    aliases: ['screenshot', 'capture', 'ssdesktop'],
    category: 'tools',
    description: 'Take a screenshot of a website',
    usage: '.ss <url> [desktop | mobile]',

    async execute(sock, msg, args, extra) {
        try {
            const input    = args[0];
            const viewport = VIEWPORTS.includes(args[1]?.toLowerCase()) ? args[1].toLowerCase() : 'desktop';

            if (!input) {
                return extra.reply(
                    '📸 Provide a URL to screenshot!\n\n' +
                    'Usage: `.ss <url> [desktop | mobile]`\n' +
                    'Example: `.ss https://google.com mobile`'
                );
            }

            const siteUrl = input.startsWith('http') ? input : `https://${input}`;

            await sock.sendMessage(extra.from, { react: { text: '⏳', key: msg.key } });

            const response = await axios.get(API_BASE, {
                params: { siteUrl, viewport },
                responseType: 'arraybuffer',
                timeout: 60000,
            });

            const imageBuffer = Buffer.from(response.data);

            if (!imageBuffer || imageBuffer.length === 0) {
                await sock.sendMessage(extra.from, { react: { text: '❌', key: msg.key } });
                return extra.reply('❌ Failed to capture. Site may be unreachable.');
            }

            const contentType = response.headers['content-type'] || 'image/png';

            await sock.sendMessage(extra.from, {
                image: imageBuffer,
                mimetype: contentType,
                caption: `📸 *${siteUrl}*\n📱 Viewport: ${viewport}\n\n> ${config.botName}`,
            }, { quoted: msg });

            await sock.sendMessage(extra.from, { react: { text: '✅', key: msg.key } });

        } catch (error) {
            console.error('[SS] error:', error.message);
            await sock.sendMessage(extra.from, { react: { text: '❌', key: msg.key } });

            let errMsg = `❌ Failed to capture: ${error.message}`;
            if (error.code === 'ECONNABORTED') errMsg = '❌ Request timed out. The site took too long to load.';
            else if (error.response?.status === 400) errMsg = '❌ Invalid URL. Please check and try again.';
            else if (error.response?.status === 500) errMsg = '❌ API server error. Try again later.';

            await extra.reply(errMsg);
        }
    }
};
