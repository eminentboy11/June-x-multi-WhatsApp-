/**
 * Song Command — powered by apiskeith.top + GiftedTech fallback
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

/**
 * Always resolves to: { downloadUrl: string, title: string, thumbnail: string }
 * Both primary and fallback are normalised to this same shape.
 */
async function downloadAudio(videoUrl) {
    return withRetry(async () => {
        // ── Primary: api.drexapp.space ────────────────────────────────────────
        try {
            const response = await axios.get(
                `https://api.drexapp.space/downloader/yta?q=${encodeURIComponent(videoUrl)}`,
                { timeout: 60000 }
            );

            const result = response.data?.result;
            if (response.data?.status && result?.dl_url) {
                return {
                    downloadUrl: result.dl_url,
                    title:       result.title     || '',
                    thumbnail:   result.thumbnail || '',
                };
            }
            throw new Error('Primary API returned no download URL');

        } catch (primaryErr) {
            console.warn('[song] primary audio API failed, trying fallback:', primaryErr.message);
        }

        // ── Fallback: mcow.giftedtechnexus ───────────────────────────────────
        try {
            const fallback = await axios.get(
                `https://mcow.giftedtechnexus.workers.dev/api/yta?url=${encodeURIComponent(videoUrl)}`,
                { timeout: 60000 }
            );

            const result = fallback.data?.result;
            if (fallback.data?.success && result?.download_url) {
                return {
                    downloadUrl: result.download_url,
                    title:       result.title     || '',
                    thumbnail:   result.thumbnail || '',
                };
            }
            throw new Error('Fallback API returned no download URL');

        } catch (fallbackErr) {
            console.error('[song] fallback audio API failed:', fallbackErr.message);
            throw new Error(`Both APIs failed. Last error: ${fallbackErr.message}`);
        }
    });
}

function getSongButtons(videoId, dateNow) {
    const prefix = config.prefix || '.';
    return [
        { id: `${prefix}audio_${videoId}_${dateNow}`,    text: '🎶 Audio' },
        { id: `${prefix}audiodoc_${videoId}_${dateNow}`, text: '📄 Audio Document' },
    ];
}

// ── Module ────────────────────────────────────────────────────────────────────

module.exports = {
    name: 'play2',
    aliases: ['song2', 'mp3', 'yta2'],
    category: 'media',
    description: 'Search and download YouTube songs as audio',
    usage: '.song <song name>',

    async execute(sock, msg, args, extra) {
        if (!args.length) {
            return extra.reply(
                `🎵 *Song Downloader*\n\n` +
                `*Usage:*\n` +
                `• \`.song not like us\` — search + download\n` +
                `• Reply to a message with \`.song\` — use replied text as query`
            );
        }

        let query = args.join(' ').trim();

        if (!query) {
            const quoted = extra?.quoted;
            query = quoted?.conversation || quoted?.extendedTextMessage?.text || '';
        }

        if (!query) {
            return extra.reply('🎵 Provide a song name.\nExample: `.song Not Like Us`');
        }

        if (query.length > 100) {
            return extra.reply('📝 Song name too long! Max 100 chars.');
        }

        const from = extra.from;
        await sock.sendMessage(from, { react: { text: '🎼', key: msg.key } });

        // Step 1: Search YouTube
        let video;
        try {
            video = await searchYouTube(query);
        } catch (e) {
            console.error('[song] search error:', e.message);
            return extra.reply(`❌ Search failed: ${e.message}`);
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

        // Step 3: Listen for button response
        const handleResponse = async (event) => {
            const messageData = event.messages[0];
            if (!messageData?.message) return;

            const selectedButtonId = extractButtonResponseId(messageData);
            if (!selectedButtonId) return;
            if (!selectedButtonId.includes(`_${dateNow}`)) return;
            if (messageData.key?.remoteJid !== from) return;

            const responseSender = getResponseSender(messageData);
            if (from.endsWith('@g.us') && responseSender !== originalSender) return;

            sock.ev.off('messages.upsert', handleResponse);
            await sock.sendMessage(from, { react: { text: '⬇️', key: msg.key } });

            // Step 4: Download & send
            try {
                const buttonType = selectedButtonId
                    .replace(prefix, '')
                    .split('_')[0];

                // downloadAudio now always returns { downloadUrl, title, thumbnail }
                const apiData = await downloadAudio(video.url);

                const tempDir = path.join(__dirname, 'temp');
                if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
                const filePath = path.join(tempDir, `audio_${dateNow}.mp3`);

                const audioStream = await axios({
                    method: 'get',
                    url: apiData.downloadUrl,   // ← consistent field, always a URL string
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

                if (buttonType === 'audio') {
                    await sock.sendMessage(from, {
                        audio: { url: filePath },
                        mimetype: 'audio/mpeg',
                    }, { quoted: messageData });

                } else if (buttonType === 'audiodoc') {
                    await sock.sendMessage(from, {
                        document: { url: filePath },
                        mimetype: 'audio/mpeg',
                        fileName: `${cleanTitle}.mp3`,
                        caption: `> ${config.botName}`,
                    }, { quoted: messageData });
                }

                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });

            } catch (error) {
                console.error('[song] download error:', error.message);
                await sock.sendMessage(from, { react: { text: '❌', key: msg.key } });
                await sock.sendMessage(from, {
                    text: `🚫 Error: ${error.message}\n\n_Try again later._`,
                }, { quoted: messageData });
            }
        };

        sock.ev.on('messages.upsert', handleResponse);
        setTimeout(() => sock.ev.off('messages.upsert', handleResponse), 120000);
    },
};
