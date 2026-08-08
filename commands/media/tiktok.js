// commands/tiktok.js

const axios = require('axios');
const config = require('../../config');

const processedMessages = new Set();

const tiktokPattern = /https?:\/\/(?:(?:www|vm|vt|m)\.)?tiktok\.com\/\S+/i;

module.exports = {
    name: 'tiktok2',
    aliases: ['tt2', 'ttdl2', 'tiktokdl2'],
    category: 'media',
    description: 'Download TikTok videos without watermark',
    usage: '.tiktok <TikTok URL>',

    async execute(sock, msg, args, extra) {
        const from = extra.from;

        try {
            if (processedMessages.has(msg.key.id)) return;
            processedMessages.add(msg.key.id);
            setTimeout(() => processedMessages.delete(msg.key.id), 5 * 60 * 1000);

            const url = args.join(' ').trim();

            if (!url) {
                return await sock.sendMessage(from, {
                    text: `❌ Please provide a TikTok URL.\n\nUsage: \`${config.prefix || '.'}tiktok <URL>\``
                }, { quoted: msg });
            }

            if (!tiktokPattern.test(url)) {
                return await sock.sendMessage(from, {
                    text: '❌ Invalid TikTok URL. Please send a valid TikTok video link.'
                }, { quoted: msg });
            }

            await sock.sendMessage(from, { react: { text: '⏳', key: msg.key } });

            const apiResponse = await axios.get('https://www.tikwm.com/api/', {
                params: { url, hd: 1 },
                timeout: 15000,
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });

            const { code, msg: apiMsg, data } = apiResponse.data;

            if (code !== 0 || !data) {
                console.error('[tiktok] API error:', apiMsg);
                await sock.sendMessage(from, { react: { text: '❌', key: msg.key } });
                return await sock.sendMessage(from, {
                    text: `❌ Failed to fetch video: ${apiMsg || 'Unknown error'}. Try again later.`
                }, { quoted: msg });
            }

            const videoUrl = data.hdplay || data.play || data.wmplay;
            if (!videoUrl) {
                await sock.sendMessage(from, { react: { text: '❌', key: msg.key } });
                return await sock.sendMessage(from, {
                    text: '❌ No download URL found for this video.'
                }, { quoted: msg });
            }

            await sock.sendMessage(from, {
                video: { url: videoUrl },
                mimetype: 'video/mp4',
                caption: config.botName,
            }, { quoted: msg });

            await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });

        } catch (error) {
            console.error('[tiktok] command error:', error.message || error);
            await sock.sendMessage(from, { react: { text: '❌', key: msg.key } });
            await sock.sendMessage(from, {
                text: '❌ An unexpected error occurred. Please try again.'
            }, { quoted: msg });
        }
    }
};
