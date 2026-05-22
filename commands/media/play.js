/**
 * Song Command — powered by GiftedTech + DrexApp fallback
 */

const yts = require('yt-search');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');                         // ← NEW
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

async function downloadAudio(videoUrl) {
    return withRetry(async () => {
        try {
            const primary = await axios.get(
                `https://mcow.giftedtechnexus.workers.dev/api/yta?url=${encodeURIComponent(videoUrl)}`,
                { timeout: 60000 }
            );
            if (primary.data?.success && primary.data?.result?.download_url) {
                return {
                    status: true,
                    result: primary.data.result.download_url,
                    title: primary.data.result.title,
                    thumbnail: primary.data.result.thumbnail,
                };
            }
            throw new Error('Primary API failed');
        } catch (err) {
            console.warn('[song] primary audio API failed, using fallback:', err.message);
            const fallback = await axios.get(
                `https://apis.xwolf.space/download/yta?url=${encodeURIComponent(videoUrl)}`,
                { timeout: 60000 }
            );
            if (!fallback.data?.status || !fallback.data?.downloadUrl) {
                throw new Error('Fallback API failed to fetch audio');
            }
            return {
                status: true,
                result: fallback.data.downloadUrl,
                title: fallback.data.title,
                thumbnail: fallback.data.thumbnail,
            };
        }
    });
}

/**
 * Convert any audio file to OGG Opus (required for WhatsApp PTT waveform).
 * Returns path to the converted .ogg file.
 */
function convertToOpus(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        const ff = spawn('ffmpeg', [
            '-y',
            '-i', inputPath,
            '-c:a', 'libopus',
            '-b:a', '128k',
            '-vn',
            outputPath,
        ]);
        ff.on('close', code =>
            code === 0 ? resolve(outputPath) : reject(new Error(`ffmpeg exited with code ${code}`))
        );
        ff.on('error', err => reject(new Error(`ffmpeg not found: ${err.message}`)));
    });
}

/**
 * Extract 64-point waveform from audio using ffmpeg PCM output.
 * Returns a Buffer of 64 bytes (values 0–100) — WhatsApp uses this to draw bars.
 */
function extractWaveform(inputPath, points = 64) {
    return new Promise((resolve) => {
        const chunks = [];
        const ff = spawn('ffmpeg', [
            '-i', inputPath,
            '-ac', '1',         // mono
            '-ar', '8000',      // 8 kHz — enough for amplitude sampling
            '-f', 's16le',      // raw signed 16-bit PCM
            'pipe:1',
        ]);

        ff.stdout.on('data', chunk => chunks.push(chunk));

        ff.on('close', () => {
            try {
                const buf = Buffer.concat(chunks);
                const totalSamples = buf.length / 2;            // 2 bytes per int16 sample
                const step = Math.max(1, Math.floor(totalSamples / points));
                const waveform = Buffer.alloc(points);

                for (let i = 0; i < points; i++) {
                    let sum = 0;
                    for (let j = 0; j < step; j++) {
                        const idx = (i * step + j) * 2;
                        if (idx + 1 < buf.length) {
                            sum += Math.abs(buf.readInt16LE(idx));
                        }
                    }
                    const avg = sum / step;
                    // Normalise to 0–100 range
                    waveform[i] = Math.min(100, Math.floor((avg / 32768) * 100));
                }
                resolve(waveform);
            } catch {
                resolve(fallbackWaveform(points));
            }
        });

        ff.on('error', () => resolve(fallbackWaveform(points)));
    });
}

/** Smooth random waveform as a safe fallback if ffmpeg PCM pipe fails */
function fallbackWaveform(points = 64) {
    const buf = Buffer.alloc(points);
    let val = 40;
    for (let i = 0; i < points; i++) {
        val = Math.min(95, Math.max(10, val + (Math.random() * 20 - 10)));
        buf[i] = Math.floor(val);
    }
    return buf;
}

function getSongButtons(videoId, dateNow) {
    const prefix = config.prefix || '.';
    return [
        { id: `${prefix}audio_${videoId}_${dateNow}`,      text: '🎶 Audio' },
        { id: `${prefix}audiodoc_${videoId}_${dateNow}`,   text: '📄 Audio Document' },
        { id: `${prefix}voicenote_${videoId}_${dateNow}`,  text: '🎙️ Voice Note' },
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
            try {
                const buttonType = selectedButtonId.replace(prefix, '').split('_')[0];
                const apiData = await downloadAudio(video.url);

                const tempDir = path.join(__dirname, 'temp');
                if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

                const mp3Path = path.join(tempDir, `audio_${dateNow}.mp3`);

                // Download MP3
                const audioStream = await axios({
                    method: 'get',
                    url: apiData.result,
                    responseType: 'stream',
                    timeout: 600000,
                });

                const writer = fs.createWriteStream(mp3Path);
                audioStream.data.pipe(writer);
                await new Promise((resolve, reject) => {
                    writer.on('finish', resolve);
                    writer.on('error', reject);
                });

                if (!fs.existsSync(mp3Path) || fs.statSync(mp3Path).size === 0) {
                    throw new Error('Download failed — file is empty');
                }

                const title = apiData.title || video.title || '';
                const cleanTitle = title.replace(/[^\w\s.-]/gi, '').substring(0, 100);

                // ── Send based on button type ─────────────────────────────────

                if (buttonType === 'audio') {
                    await sock.sendMessage(from, {
                        audio: { url: mp3Path },
                        mimetype: 'audio/mpeg',
                    }, { quoted: messageData });

                } else if (buttonType === 'audiodoc') {
                    await sock.sendMessage(from, {
                        document: { url: mp3Path },
                        mimetype: 'audio/mpeg',
                        fileName: `${cleanTitle}.mp3`,
                        caption: `🎵 ${cleanTitle}\n> ${config.botName}`,
                    }, { quoted: messageData });

                } else if (buttonType === 'voicenote') {
                    // Convert MP3 → OGG Opus (required for waveform display)
                    const oggPath = path.join(tempDir, `vn_${dateNow}.ogg`);
                    await convertToOpus(mp3Path, oggPath);

                    // Extract real waveform from the converted audio
                    const waveform = await extractWaveform(oggPath);

                    await sock.sendMessage(from, {
                        audio: fs.readFileSync(oggPath),    // buffer — not URL — for waveform to attach
                        mimetype: 'audio/ogg; codecs=opus',
                        ptt: true,                          // renders as voice note
                        waveform,                           // 64-byte amplitude map → draws the bars
                    }, { quoted: messageData });

                    if (fs.existsSync(oggPath)) fs.unlinkSync(oggPath);
                }

                if (fs.existsSync(mp3Path)) fs.unlinkSync(mp3Path);
                await sock.sendMessage(from
