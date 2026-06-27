// commands/tiktok.js

const axios = require('axios');
const { sendButtons } = require('gifted-btns');
const config = require('../../config');

const processedMessages = new Set();

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractButtonResponseId(msg) {
    return (
        msg.message?.buttonsResponseMessage?.selectedButtonId ||
        msg.message?.templateButtonReplyMessage?.selectedId ||
        msg.message?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson ||
        null
    );
}

function getResponseSender(msg) {
    return msg.key?.participant || msg.key?.remoteJid;
}

function getTikTokButtons(videoId, dateNow, tiktokUrl) {
    const prefix = config.prefix || '.';
    return [
        { id: `${prefix}ttvideo_${videoId}_${dateNow}`, text: '🎬 Video (No Watermark)' },
        { type: 'cta_url', text: '🔗 Open on TikTok', url: tiktokUrl },
    ];
}

const tiktokPattern = /https?:\/\/(?:(?:www|vm|vt|m)\.)?tiktok\.com\/\S+/i;

// ── Fetch with fallback ───────────────────────────────────────────────────────

async function fetchTikTokData(url) {
    // Primary: tikwm
    try {
        const { data } = await axios.get('https://www.tikwm.com/api/', {
            params: { url, hd: 1 },
            timeout: 15000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        if (data?.code === 0 && data?.data?.play) {
            const d = data.data;
            return {
                videoUrl:  d.hdplay || d.play,
                cover:     d.cover || d.origin_cover || d.dynamic_cover,
                author:    d.author?.unique_id || 'unknown',
                title:     d.title || '',
                duration:  d.duration ?? 'N/A',
                likes:     (d.digg_count ?? 0).toLocaleString(),
                comments:  (d.comment_count ?? 0).toLocaleString(),
                shares:    (d.share_count ?? 0).toLocaleString(),
                id:        d.id || null,
            };
        }
    } catch (_) {}

    // Fallback: tiklydown
    try {
        const { data } = await axios.get(
            `https://api.tiklydown.eu.org/api/download?url=${encodeURIComponent(url)}`,
            { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } }
        );

        if (data?.video?.noWatermark) {
            return {
                videoUrl: data.video.noWatermark,
                cover:    data.video.cover || null,
                author:   data.author?.name || 'unknown',
                title:    data.title || '',
                duration: data.duration ?? 'N/A',
                likes:    (data.stats?.likeCount ?? 0).toLocaleString(),
                comments: (data.stats?.commentCount ?? 0).toLocaleString(),
                shares:   (data.stats?.shareCount ?? 0).toLocaleString(),
                id:       null,
            };
        }
    } catch (_) {}

    return null;
}

// ── Module ────────────────────────────────────────────────────────────────────

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

            const data = await fetchTikTokData(url);

            if (!data) {
                await sock.sendMessage(from, { react: { text: '❌', key: msg.key } });
                return await sock.sendMessage(from, {
                    text: `❌ Failed to fetch video. The link may be private or unsupported.`
                }, { quoted: msg });
            }

            const dateNow        = Date.now();
            const videoId        = data.id || dateNow.toString();
            const originalSender = msg.key?.participant || msg.key?.remoteJid;

            await sendButtons(sock, from, {
                title: '📥 TIKTOK DOWNLOADER',
                image: data.cover ? { url: data.cover } : undefined,
                text:
                    `⿻ *Author:* @${data.author}\n` +
                    `⿻ *Caption:* ${(data.title || 'N/A').substring(0, 80)}\n` +
                    `⿻ *Duration:* ${data.duration}s\n` +
                    `⿻ *Likes:* ${data.likes}\n` +
                    `⿻ *Comments:* ${data.comments}\n` +
                    `⿻ *Shares:* ${data.shares}\n\n` +
                    `*Select download format:*`,
                footer: `Made by ${config.botName}`,
                buttons: getTikTokButtons(videoId, dateNow, url),
            }, { quoted: msg });

            await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });

            const handleResponse = async (event) => {
                const messageData = event.messages[0];
                if (!messageData?.message) return;

                const selectedButtonId = extractButtonResponseId(messageData);
                if (!selectedButtonId) return;

                if (!selectedButtonId.includes(`_${dateNow}`)) return;
                if (messageData.key?.remoteJid !== from) return;

                const responseSender = getResponseSender(messageData);
                if (from.endsWith('@g.us') && responseSender !== originalSender) return;

                await sock.sendMessage(from, { react: { text: '⬇️', key: msg.key } });

                try {
                    if (!data.videoUrl) throw new Error('No download URL found.');

                    await sock.sendMessage(from, {
                        video: { url: data.videoUrl },
                        mimetype: 'video/mp4',
                    }, { quoted: messageData });

                    await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });

                } catch (err) {
                    console.error('[tiktok] download error:', err.message);
                    await sock.sendMessage(from, { react: { text: '❌', key: msg.key } });
                    await sock.sendMessage(from, {
                        text: `🚫 Error: ${err.message}\n\n_Try again later._`
                    }, { quoted: messageData });
                }
            };

            sock.ev.on('messages.upsert', handleResponse);

        } catch (error) {
            console.error('[tiktok] command error:', error.message || error);
            await sock.sendMessage(from, { react: { text: '❌', key: msg.key } });
            await sock.sendMessage(from, {
                text: '❌ An unexpected error occurred. Please try again.'
            }, { quoted: msg });
        }
    }
};
