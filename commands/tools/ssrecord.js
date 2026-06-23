/**
 * SSRecord Command
 * Records a website screen as a video using snapshot.xwolf.space
 */

const axios = require('axios');
const config = require('../../config');

const API_BASE = 'https://snapshot.xwolf.space/api/record';
const VIEWPORTS = ['desktop', 'mobile'];

module.exports = {
    name: 'ssrecord',
    aliases: ['ssr', 'webrecord', 'screenrecord'],
    category: 'tools',
    description: 'Record a website screen as a video',
    usage: '.ssrecord <url> [desktop | mobile]',

    async execute(sock, msg, args, extra) {
        try {
            const input    = args[0];
            const viewport = VIEWPORTS.includes(args[1]?.toLowerCase()) ? args[1].toLowerCase() : 'desktop';

            if (!input) {
                return extra.reply(
                    '🎥 Provide a URL to record!\n\n' +
                    'Usage: `.ssrecord <url> [desktop | mobile]`\n' +
                    'Example: `.ssrecord https://google.com mobile`'
                );
            }

            // Ensure URL has protocol
            const siteUrl = input.startsWith('http') ? input : `https://${input}`;

            await sock.sendMessage(extra.from, { react: { text: '⏳', key: msg.key } });
            await extra.reply(`🎥 Recording *${siteUrl}* on *${viewport}*...\nThis may take a few seconds.`);

            const response = await axios.get(API_BASE, {
                params: { siteUrl, viewport },
                responseType: 'arraybuffer',
                timeout: 60000,
            });

            const videoBuffer = Buffer.from(response.data);

            if (!videoBuffer || videoBuffer.length === 0) {
                await sock.sendMessage(extra.from, { react: { text: '❌', key: msg.key } });
                return extra.reply('❌ Failed to record. Site may be unreachable.');
            }

            const sizeMB = (videoBuffer.length / 1048576).toFixed(2);

            await sock.sendMessage(extra.from, {
                video: videoBuffer,
                mimetype: 'video/webm',
                caption: `🎥 *${siteUrl}*\n📱 Viewport: ${viewport}\n📦 Size: ${sizeMB} MB\n\n> ${config.botName}`,
            }, { quoted: msg });

            await sock.sendMessage(extra.from, { react: { text: '✅', key: msg.key } });

        } catch (error) {
            console.error('[SSRecord] error:', error.message);
            await sock.sendMessage(extra.from, { react: { text: '❌', key: msg.key } });

            let errMsg = `❌ Failed to record: ${error.message}`;
            if (error.code === 'ECONNABORTED') errMsg = '❌ Request timed out. The site took too long to load.';
            else if (error.response?.status === 400) errMsg = '❌ Invalid URL. Please check and try again.';
            else if (error.response?.status === 500) errMsg = '❌ API server error. Try again later.';

            await extra.reply(errMsg);
        }
    }
};
