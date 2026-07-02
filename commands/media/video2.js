/**
 * YTMP4 Command — powered by apiskeith.top + cod3uchiha fallback
 */

const yts = require('yt-search');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { sendButtons } = require('gifted-btns');
const config = require('../../config');

const RETRY_DELAY = 3000;

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

async function withRetry(fn, retries = 3, delayMs = RETRY_DELAY) {
    let lastErr;
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (e) {
            lastErr = e;
            const isBusy = e.message?.toLowerCase().includes('busy') ||
                           e.message?.toLowerCase().includes('try again');
            if (i < retries - 1 && isBusy) {
                await new Promise(r => setTimeout(r, delayMs));
            } else if (!isBusy) {
                throw e;
            }
        }
    }
    throw lastErr;
}

async function searchYouTube(query) {
    return withRetry(async () => {
        const result = await yts(`${query} official`);
        if (!result?.videos?.length) throw new Error('No results found');
        return result.videos[0];
    });
}

async function downloadVideo(videoUrl) {
    return withRetry(async () => {
        try {
            // Primary API - Fixed endpoint
            const response = await axios.get(
                `https://apiskeith.top/api/ytmp4?url=${encodeURIComponent(videoUrl)}`,
                { timeout: 60000 }
            );
            
            if (response.data?.status && response.data?.result) {
                return {
                    status: true,
                    result: response.data.result,
                    title: response.data.title || 'YouTube Video',
                    format: response.data.format || 'mp4'
                };
            }
            throw new Error('Primary API failed');
        } catch (err) {
            console.warn('[ytmp4] primary video API failed, using fallback:', err.message);

            // Fallback API - Fixed
            const fallback = await axios.get(
                `https://iamtkm.vercel.app/downloaders/ytmp4?apikey=tkm&url=${encodeURIComponent(videoUrl)}`,
                { timeout: 60000 }
            );
            
            if (!fallback.data?.data?.url) {
                throw new Error('Fallback API failed to fetch video');
            }
            
            return {
                status: true,
                result: fallback.data.data.url,
                title: fallback.data.data.title || 'YouTube Video',
                format: fallback.data.data.format || 'mp4',
            };
        }
    });
}

function getVideoButtons(videoId, dateNow) {
    const prefix = config.prefix || '.';
    return [
        { id: `${prefix}video_${videoId}_${dateNow}`,    text: '🎬 Video' },
        { id: `${prefix}videodoc_${videoId}_${dateNow}`, text: '📄 Video Document' },
    ];
}

// ── Module ────────────────────────────────────────────────────────────────────

module.exports = {
    name: 'video2',
    aliases: ['ytvideo2', 'mp42', 'ytv2'],
    category: 'media',
    description: 'Search and download YouTube videos as MP4',
    usage: '.ytmp4 <video name>',

    async execute(sock, msg, args, extra) {
        if (!args.length) {
            return extra.reply(
                `🎬 *YouTube Video Downloader*\n\n` +
                `*Usage:*\n` +
                `• \`.ytmp4 not like us\` — search + download\n` +
                `• Reply to a message with \`.ytmp4\` — use replied text as query`
            );
        }

        let query = args.join(' ').trim();

        if (!query) {
            const quoted = extra?.quoted;
            query = quoted?.conversation || quoted?.extendedTextMessage?.text || '';
        }

        if (!query) {
            return extra.reply('🎬 Provide a video name.\nExample: `.ytmp4 Not Like Us`');
        }

        if (query.length > 100) {
            return extra.reply('📝 Video name too long! Max 100 chars.');
        }

        const from = extra.from;
        await sock.sendMessage(from, { react: { text: '🎥', key: msg.key } });

        // Step 1: Search YouTube
        let video;
        try {
            video = await searchYouTube(query);
        } catch (e) {
            console.error('[ytmp4] search error:', e.message);
            return extra.reply(`❌ Search failed: ${e.message}`);
        }

        const dateNow = Date.now();
        const prefix = config.prefix || '.';
        const originalSender = msg.key.participant || msg.key.remoteJid;

        // Store video data for later use
        const videoData = {
            url: video.url,
            title: video.title,
            videoId: video.videoId,
            timestamp: video.timestamp,
            views: video.views,
            author: video.author
        };

        // Step 2: Send format selection buttons
        await sendButtons(sock, from, {
            title: `🎬 VIDEO DOWNLOADER`,
            text:
                `⿻ *Title:* ${video.title}\n` +
                `⿻ *Duration:* ${video.timestamp || 'N/A'}\n` +
                `⿻ *Views:* ${video.views?.toLocaleString() ?? 'N/A'}\n` +
                `⿻ *Channel:* ${video.author?.name || 'N/A'}\n` +
                `⿻ *Link:* ${video.url}\n\n` +
                `*Select download format:*`,
            footer: `Made by ${config.botName}`,
            buttons: getVideoButtons(video.videoId, dateNow),
        }, { quoted: msg });

        await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });

        // Step 3: Listen for button responses
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

            // Step 4: Download & send
            try {
                const buttonType = selectedButtonId
                    .replace(prefix, '')
                    .split('_')[0];

                // Use the stored video URL
                const apiData = await downloadVideo(videoData.url);

                // Create temp directory
                const tempDir = path.join(__dirname, 'temp');
                if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
                const filePath = path.join(tempDir, `video_${dateNow}.mp4`);

                // Download video with better error handling
                const videoStream = await axios({
                    method: 'get',
                    url: apiData.result,
                    responseType: 'stream',
                    timeout: 600000,
                    maxRedirects: 5,
                });

                const writer = fs.createWriteStream(filePath);
                videoStream.data.pipe(writer);

                await new Promise((resolve, reject) => {
                    writer.on('finish', resolve);
                    writer.on('error', reject);
                });

                // Check if file exists and has content
                if (!fs.existsSync(filePath)) {
                    throw new Error('File was not created');
                }

                const stats = fs.statSync(filePath);
                if (stats.size === 0) {
                    throw new Error('Downloaded file is empty');
                }

                const title = apiData.title || videoData.title || 'YouTube Video';
                const cleanTitle = title.replace(/[^\w\s.-]/gi, '').substring(0, 100);

                // Send video based on button type
                if (buttonType === 'video') {
                    await sock.sendMessage(from, {
                        video: fs.readFileSync(filePath),
                        mimetype: 'video/mp4',
                        caption: `🎬 ${title}\n\n> Downloaded via ${config.botName}`,
                    }, { quoted: messageData });

                } else if (buttonType === 'videodoc') {
                    await sock.sendMessage(from, {
                        document: fs.readFileSync(filePath),
                        mimetype: 'video/mp4',
                        fileName: `${cleanTitle}.mp4`,
                        caption: `🎬 ${title}\n\n> Downloaded via ${config.botName}`,
                    }, { quoted: messageData });
                }

                // Clean up
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
                await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });

            } catch (error) {
                console.error('[ytmp4] download error:', error.message);
                await sock.sendMessage(from, { react: { text: '❌', key: msg.key } });
                await sock.sendMessage(from, {
                    text: `🚫 Error: ${error.message}\n\n_Try again later or use a different video._`,
                }, { quoted: messageData });
            }
        };

        sock.ev.on('messages.upsert', handleResponse);
    },
};
