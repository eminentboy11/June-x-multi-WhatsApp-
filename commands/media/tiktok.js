/**
 * TikTok Downloader - Download TikTok videos
 */

const axios = require('axios');
const config = require('../../config');

const processedMessages = new Set();

module.exports = {
    name: 'tiktok',
    aliases: ['tt', 'ttdl', 'tiktokdl'],
    category: 'media',
    description: 'Download TikTok videos without watermark',
    usage: '.tiktok <TikTok URL>',

    async execute(sock, msg, args, extra) {
        const chatId = extra.from;

        try {
            // Prevent duplicate processing
            if (processedMessages.has(msg.key.id)) return;
            processedMessages.add(msg.key.id);
            setTimeout(() => processedMessages.delete(msg.key.id), 5 * 60 * 1000);

            const url = args.join(' ').trim();

            if (!url) {
                return await sock.sendMessage(chatId, {
                    text: '❌ Please provide a TikTok URL.\n\nUsage: .tiktok <TikTok URL>'
                }, { quoted: msg });
            }

            const tiktokPattern = /https?:\/\/(?:(?:www|vm|vt|m)\.)?tiktok\.com\/\S+/i;

            if (!tiktokPattern.test(url)) {
                return await sock.sendMessage(chatId, {
                    text: '❌ Invalid TikTok URL. Please send a valid TikTok video link.'
                }, { quoted: msg });
            }

            await sock.sendMessage(chatId, {
                react: { text: '⏳', key: msg.key }
            });

            // ✅ tikwm.com — stable public TikTok downloader API
            const apiResponse = await axios.get('https://www.tikwm.com/api/', {
                params: { url, hd: 1 },
                timeout: 15000,
                headers: {
                    'User-Agent': 'Mozilla/5.0'
                }
            });

            const { code, msg: apiMsg, data } = apiResponse.data;

            // code 0 = success
            if (code !== 0 || !data) {
                console.error('TikWM API error:', apiMsg);
                return await sock.sendMessage(chatId, {
                    text: `❌ Failed to fetch video: ${apiMsg || 'Unknown error'}. Try again later.`
                }, { quoted: msg });
            }

            // `play` = no watermark, `wmplay` = with watermark, `hdplay` = HD no watermark
            const videoUrl = data.hdplay || data.play || data.wmplay;

            if (!videoUrl) {
                return await sock.sendMessage(chatId, {
                    text: '❌ Could not extract video URL. The video may be private or deleted.'
                }, { quoted: msg });
            }

            const caption = [
                `🎵 *${data.title || 'TikTok Video'}*`,
                `👤 @${data.author?.unique_id || 'unknown'}`,
                `❤️ ${data.digg_count ?? 0}  💬 ${data.comment_count ?? 0}  🔁 ${data.share_count ?? 0}`,
                '',
                `> ${config.botName}`
            ].join('\n');

            await sock.sendMessage(chatId, {
                video: { url: videoUrl },
                mimetype: 'video/mp4',
                caption
            }, { quoted: msg });

            // ✅ Done react
            await sock.sendMessage(chatId, {
                react: { text: '✅', key: msg.key }
            });

        } catch (error) {
            console.error('TikTok command error:', error.message || error);
            await sock.sendMessage(chatId, {
                text: '❌ An unexpected error occurred while downloading. Please try again.'
            }, { quoted: msg });
        }
    }
};
