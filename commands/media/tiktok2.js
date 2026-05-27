/**
 * TikTok Downloader — no buttons, sends video directly
 */

const axios  = require('axios');
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
            // ── Duplicate guard ───────────────────────────────────────────────
            if (processedMessages.has(msg.key.id)) return;
            processedMessages.add(msg.key.id);
            setTimeout(() => processedMessages.delete(msg.key.id), 5 * 60 * 1000);

            // ── Validate input ────────────────────────────────────────────────
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

            // ── Fetch video metadata ──────────────────────────────────────────
            const { data: res } = await axios.get('https://www.tikwm.com/api/', {
                params:  { url, hd: 1 },
                timeout: 15000,
                headers: { 'User-Agent': 'Mozilla/5.0' },
            });

            if (res.code !== 0 || !res.data) {
                return await sock.sendMessage(from, {
                    text: `❌ Failed to fetch video: ${res.msg || 'Unknown error'}. Try again later.`
                }, { quoted: msg });
            }

            const data     = res.data;
            const videoUrl = data.hdplay || data.play || data.wmplay;

            if (!videoUrl) {
                return await sock.sendMessage(from, {
                    text: '❌ Could not extract video URL. The video may be private or deleted.'
                }, { quoted: msg });
            }

            const caption =
                `🎵 *${data.title || 'TikTok Video'}*\n` +
                `👤 @${data.author?.unique_id || 'unknown'}\n` +
                `❤️ ${data.digg_count ?? 0}  💬 ${data.comment_count ?? 0}  🔁 ${data.share_count ?? 0}\n` +
                `> ${config.botName}`;

            // ── Send video ────────────────────────────────────────────────────
            await sock.sendMessage(from, {
                video:    { url: videoUrl },
                mimetype: 'video/mp4',
                caption,
            }, { quoted: msg });

            await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });

        } catch (error) {
            console.error('[tiktok] error:', error.message || error);
            await sock.sendMessage(from, {
                text: '❌ An unexpected error occurred. Please try again.'
            }, { quoted: msg });
        }
    }
};
