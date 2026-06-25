/**
 * Song Command — powered by GiftedTech + DrexApp fallback
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

async function getVideoFromUrl(url) {
    const ytId = (url.match(/(?:youtu\.be\/|v=)([a-zA-Z0-9_-]{11})/) || [])[1];
    if (!ytId) throw new Error('Invalid YouTube URL');
    const result = await yts({ videoId: ytId });
    if (!result?.title) throw new Error('Could not fetch video info');
    return {
        title: result.title,
        timestamp: result.timestamp || '',
        views: result.views || 0,
        author: result.author || {},
        url: url,
        videoId: ytId,
    };
}

async function downloadAudio(videoUrl) {
    return withRetry(async () => {
        try {
            // Primary
            const primary = await axios.get(
                `https://phantom-api.us.ci/api/download/youtube2?url=${encodeURIComponent(videoUrl)}`,
                { timeout: 60000 }
            );
            if (primary.data?.success && primary.data?.result?.download_url) {
                return {
                    status: true,
                    result: primary.data.result.download_url,
                    title: primary.data.result.title,
                };
            }
            throw new Error('Primary API failed');
        } catch (err) {
            console.warn('[play2] primary API failed, using fallback:', err.message);

            // Fallback
            const fallback = await axios.get(
                `https://yt-dl.officialhectormanuel.workers.dev/?url=${encodeURIComponent(videoUrl)}`,
                { timeout: 60000 }
            );
            if (!fallback.data?.status || !fallback.data?.audio) {
                throw new Error('Fallback API failed to fetch audio');
            }
            return {
                status: true,
                result: fallback.data.audio,
                title: fallback.data.title,
                thumbnail: fallback.data.thumbnail,
            };
        }
    });
}

function getSongButtons(videoId, dateNow) {
    const prefix = config.prefix || '.';
    return [
        { id: `${prefix}audio_${videoId}_${dateNow}`,     text: '🎶 Audio' },
        { id: `${prefix}audiodoc_${videoId}_${dateNow}`,  text: '📄 Audio Document' },
    ];
}

// ── Module ────────────────────────────────────────────────────────────────────

module.exports = {
    name: 'play2',
    aliases: ['song2', 'mp3', 'yta2'],
    category: 'media',
    description: 'Search and download YouTube songs as audio',
    usage: '.play2 <song name or YouTube URL>',

    async execute(sock, msg, args, extra) {
        if (!args.length) {
            return extra.reply(
                `🎵 *Song Downloader*\n\n` +
                `*Usage:*\n` +
                `• \`.play2 not like us\` — search by name\n` +
                `• \`.play2 https://youtu.be/xxx\` — use YouTube link\n` +
                `• Reply to a message with \`.play2\` — use replied text as query`
            );
        }

        let query = args.join(' ').trim();

        if (!query) {
            const quoted = extra?.quoted;
            query = quoted?.conversation || quoted?.extendedTextMessage?.text || '';
        }

        if (!query) {
            return extra.reply('🎵 Provide a song name or YouTube URL.\nExample: `.play2 Not Like Us`');
        }

        if (query.length > 200) {
            return extra.reply('📝 Query too long! Max 200 chars.');
        }

        const from = extra.from;
        await sock.sendMessage(from, { react: { text: '🎼', key: msg.key } });

        // Step 1: Search YouTube OR resolve URL directly
        const isUrl = query.startsWith('http://') || query.startsWith('https://');
        let video;

        try {
            video = isUrl
                ? await getVideoFromUrl(query)
                : await searchYouTube(query);
        } catch (e) {
            console.error('[play2] video resolve error:', e.message);
            return extra.reply(`❌ ${isUrl ? 'Could not fetch video info' : 'Search failed'}: ${e.message}`);
        }

        const dateNow = Date.now();
        const prefix = config.prefix || '.';
        const originalSender = msg.key.participant || msg.key.remoteJid;

        // Step 2: Send format selection buttons
        await sendButtons(sock, from, {
            title: `🎵 SONG DOWNLOADER`,
            text:
                `⿻ *Title:* ${video.title}\n` +
                `⿻ *Duration:* ${video.timestamp || 'N/A'}\n` +
                `⿻ *Views:* ${video.views?.toLocaleString() ?? 'N/A'}\n` +
                `⿻ *Channel:* ${video.author?.name || 'N/A'}\n` +
                `⿻ *Link:* ${video.url}\n\n` +
                `*Select download format:*`,
            footer: `Made by ${config.botName}`,
            buttons: getSongButtons(video.videoId, dateNow),
        }, { quoted: msg });

        await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });

        // Step 3: Listen for button responses — persistent, no expiry, multi-tap
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
            let filePath;
            try {
                const buttonType = selectedButtonId
                    .replace(prefix, '')
                    .split('_')[0];

                const apiData = await downloadAudio(video.url);

                const tempDir = path.join(__dirname, 'temp');
                if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
                filePath = path.join(tempDir, `audio_${dateNow}.mp3`);

                const audioStream = await axios({
                    method: 'get',
                    url: apiData.result,
                    responseType: 'stream',
                    timeout: 600000,
                });

                const writer = fs.createWriteStream(filePath);
                audioStream.data.pipe(writer);
                await new Promise((resolve, reject) => {
                    writer.on('finish', resolve);
                    writer.on('error', reject);
                });

                if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
                    throw new Error('Download failed — file is empty');
                }

                const title = apiData.title || video.title || '';
                const cleanTitle = title.replace(/[^\w\s.-]/gi, '').substring(0, 100);
                const audioBuffer = fs.readFileSync(filePath);

                if (buttonType === 'audio') {
                    await sock.sendMessage(from, {
                        audio: audioBuffer,
                        mimetype: 'audio/mpeg',
                    }, { quoted: messageData });

                } else if (buttonType === 'audiodoc') {
                    await sock.sendMessage(from, {
                        document: audioBuffer,
                        mimetype: 'audio/mpeg',
                        fileName: `${cleanTitle}.mp3`,
                    }, { quoted: messageData });

                } else if (buttonType === 'voicenote') {
                    await sock.sendMessage(from, {
                        audio: audioBuffer,
                        mimetype: 'audio/ogg; codecs=opus',
                        ptt: true,
                    }, { quoted: messageData });
                }

                await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });

            } catch (error) {
                console.error('[play2] download error:', error.message);
                await sock.sendMessage(from, { react: { text: '❌', key: msg.key } });
                await sock.sendMessage(from, {
                    text: `🚫 Error: ${error.message}\n\n_Try again later._`,
                }, { quoted: messageData });
            } finally {
                if (filePath && fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            }
        };

        sock.ev.on('messages.upsert', handleResponse);
    },
};
