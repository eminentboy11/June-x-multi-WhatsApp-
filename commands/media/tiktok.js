/**
 * TikTok Downloader - Download TikTok videos
 */

const axios = require('axios');
const config = require('../../config');

// Store processed message IDs to prevent duplicates
const processedMessages = new Set();

module.exports = {
    name: 'tiktok',
    aliases: ['tt', 'ttdl', 'tiktokdl'],
    category: 'media',
    description: 'Download TikTok videos',
    usage: '.tiktok <TikTok URL>',

    async execute(sock, msg, args, extra) {
        const chatId = extra.from;

        try {
            // Prevent duplicate processing
            if (processedMessages.has(msg.key.id)) return;
            processedMessages.add(msg.key.id);
            setTimeout(() => processedMessages.delete(msg.key.id), 5 * 60 * 1000);

            const text = msg.message?.conversation ||
                         msg.message?.extendedTextMessage?.text ||
                         args.join(' ');

            if (!text) {
                return await sock.sendMessage(chatId, {
                    text: 'Please provide a TikTok link for the video.'
                }, { quoted: msg });
            }

            const url = text.split(' ').slice(1).join(' ').trim();

            if (!url) {
                return await sock.sendMessage(chatId, {
                    text: 'Please provide a TikTok link for the video.'
                }, { quoted: msg });
            }

            const tiktokPatterns = [
                /https?:\/\/(?:www\.)?tiktok\.com\//,
                /https?:\/\/(?:vm\.)?tiktok\.com\//,
                /https?:\/\/(?:vt\.)?tiktok\.com\//,
                /https?:\/\/(?:www\.)?tiktok\.com\/@/,
                /https?:\/\/(?:www\.)?tiktok\.com\/t\//
            ];

            const isValidUrl = tiktokPatterns.some(pattern => pattern.test(url));
            if (!isValidUrl) {
                return await sock.sendMessage(chatId, {
                    text: 'That is not a valid TikTok link. Please provide a valid TikTok video link.'
                }, { quoted: msg });
            }

            await sock.sendMessage(chatId, {
                react: { text: '↘️', key: msg.key }
            });

            try {
                const apiResponse = await axios.get(
                    `https://apiskeith.top/download/tiktokdl3?url=${encodeURIComponent(url)}`
                );
                const data = apiResponse.data;

                if (data && data.status && data.result) {
                    const videoUrl = data.result;
                    const caption = config.botName;

                    await sock.sendMessage(chatId, {
                        video: { url: videoUrl },
                        mimetype: 'video/mp4',
                        caption: caption
                    }, { quoted: msg });

                } else {
                    return await sock.sendMessage(chatId, {
                        text: 'Failed to fetch video. Please check the link or try again later.'
                    }, { quoted: msg });
                }

            } catch (error) {
                console.error('Error in TikTok API:', error.message || error);
                await sock.sendMessage(chatId, {
                    text: 'Failed to download the TikTok video. Please try again later.'
                }, { quoted: msg });
            }

        } catch (error) {
            console.error('Error in TikTok command:', error.message || error);
            await sock.sendMessage(chatId, {
                text: 'An unexpected error occurred. Please try again.'
            }, { quoted: msg });
        }
    }
};
