/**
 * SaveTube Command — powered by api.nexray.eu.cc
 * Download: GET /downloader/savetube?url=<youtube_url>&quality=<quality>
 *
 * Quality values:
 *   Audio  → mp3
 *   Video  → mp4 | 360 | 480 | 720 | 1080
 */

const yts = require('yt-search');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { sendButtons } = require('gifted-btns');
const config = require('../../config');

const RETRY_DELAY = 3000;
const BASE = 'https://api.nexray.eu.cc';

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

function isYouTubeUrl(text) {
    return /https?:\/\/(www\.)?(youtube\.com\/watch|youtu\.be\/)[^\s]+/i.test(text);
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
 * Download via SaveTube API
 * quality: 'mp3' | 'mp4' | '360' | '480' | '720' | '1080'
 * Expected response: { status, result: { title, download_url, thumbnail, duration, quality, ... } }
 */
async function downloadSaveTube(videoUrl, quality) {
    return withRetry(async () => {
        console.log(`[savetube] downloading: ${videoUrl} @ ${quality}`);
        const res = await axios.get(
            `${BASE}/downloader/savetube?url=${encodeURIComponent(videoUrl)}&quality=${quality}`,
            { timeout: 120000 }
        );
        const result = res.data?.result;
        if (!res.data?.status || !result?.download_url) {
            throw new Error(`SaveTube API returned no URL for quality: ${quality}`);
        }
        console.log('[savetube] delivering:', result.title);
        return {
            downloadUrl: result.download_url,
            title:       result.title     || '',
            thumbnail:   result.thumbnail || '',
            duration:    result.duration  || '',
            quality:     result.quality   || quality,
            size:        result.size      || '',
        };
    });
}

/**
 * Type buttons — Audio or Video
 * ID: <prefix>st_type_<type>_<dateNow>
 */
function getTypeButtons(dateNow) {
    const prefix = config.prefix || '.';
    return [
        { id: `${prefix}st_type_audio_${dateNow}`, text: '🎵 Audio (MP3)' },
        { id: `${prefix}st_type_video_${dateNow}`, text: '🎬 Video (MP4)' },
    ];
}

/**
 * Audio format buttons
 * ID: <prefix>st_afmt_<format>_<dateNow>
 */
function getAudioFormatButtons(dateNow) {
    const prefix = config.prefix || '.';
    return [
        { id: `${prefix}st_afmt_audio_${dateNow}`,    text: '🎶 Audio' },
        { id: `${prefix}st_afmt_audiodoc_${dateNow}`, text: '📄 Audio Document' },
    ];
}

/**
 * Video quality buttons
 * ID: <prefix>st_vq_<quality>_<dateNow>
 */
function getVideoQualityButtons(dateNow) {
    const prefix = config.prefix || '.';
    return [
        { id: `${prefix}st_vq_360_${dateNow}`,  text: '📱 360p' },
        { id: `${prefix}st_vq_480_${dateNow}`,  text: '💻 480p' },
        { id: `${prefix}st_vq_720_${dateNow}`,  text: '🖥️ 720p HD' },
        { id: `${prefix}st_vq_1080_${dateNow}`, text: '🎯 1080p FHD' },
    ];
}

/**
 * Video send-as buttons (after quality chosen)
 * ID: <prefix>st_vfmt_<format>_<quality>_<dateNow>
 */
function getVideoFormatButtons(quality, dateNow) {
    const prefix = config.prefix || '.';
    return [
        { id: `${prefix}st_vfmt_video_${quality}_${dateNow}`,    text: '🎬 Video' },
        { id: `${prefix}st_vfmt_videodoc_${quality}_${dateNow}`, text: '📄 Video Document' },
    ];
}

// ── Module ────────────────────────────────────────────────────────────────────

module.exports = {
    name: 'savetube',
    aliases: ['stube', 'svtube', 'ytdl'],
    category: 'media',
    description: 'Download YouTube videos or audio via SaveTube API',
    usage: '.savetube <video name | youtube link>',

    async execute(sock, msg, args, extra) {
        if (!args.length) {
            return extra.reply(
                `📥 *SaveTube Downloader*\n\n` +
                `*Usage:*\n` +
                `• \`.savetube not like us\` — search + download\n` +
                `• \`.savetube https://youtube.com/watch?v=...\` — download via link\n` +
                `• Reply to a message with \`.savetube\` — use replied text as query`
            );
        }

        let query = args.join(' ').trim();

        if (!query) {
            const quoted = extra?.quoted;
            query = quoted?.conversation || quoted?.extendedTextMessage?.text || '';
        }

        if (!query) {
            return extra.reply('📥 Provide a video name or YouTube link.\nExample: `.savetube Not Like Us`');
        }

        if (query.length > 200) {
            return extra.reply('📝 Query too long! Max 200 chars.');
        }

        const from           = extra.from;
        const prefix         = config.prefix || '.';
        const originalSender = msg.key.participant || msg.key.remoteJid;

        // ── Resolve video URL ─────────────────────────────────────────────────
        let videoUrl;
        let videoMeta = null;

        if (isYouTubeUrl(query)) {
            videoUrl = query;
            await sock.sendMessage(from, { react: { text: '🔗', key: msg.key } });
        } else {
            await sock.sendMessage(from, { react: { text: '🔍', key: msg.key } });
            try {
                videoMeta = await searchYouTube(query);
                videoUrl  = videoMeta.url;
            } catch (e) {
                console.error('[savetube] search error:', e.message);
                return extra.reply(`❌ Search failed: ${e.message}`);
            }
        }

        const dateNow = Date.now();

        // ── Step 1: Send video info + type selection buttons ──────────────────
        await sendButtons(sock, from, {
            title: `📥 SAVETUBE DOWNLOADER`,
            text:
                (videoMeta
                    ? `⿻ *Title:*    ${videoMeta.title}\n` +
                      `⿻ *Duration:* ${videoMeta.timestamp || 'N/A'}\n` +
                      `⿻ *Views:*    ${videoMeta.views?.toLocaleString() ?? 'N/A'}\n` +
                      `⿻ *Channel:*  ${videoMeta.author?.name || 'N/A'}\n` +
                      `⿻ *Link:*     ${videoUrl}\n\n`
                    : `⿻ *Link:* ${videoUrl}\n\n`
                ) +
                `*Select download type:*`,
            footer:   `Made by ${config.botName}`,
            buttons:  getTypeButtons(dateNow),
        }, { quoted: msg });

        await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });

        // ── Step 2: Listen for type selection — persistent, multi-tap ─────────
        const handleTypeSelect = async (event) => {
            const messageData = event.messages[0];
            if (!messageData?.message) return;

            const selectedId = extractButtonResponseId(messageData);
            if (!selectedId) return;
            if (!selectedId.includes('st_type_') || !selectedId.includes(`_${dateNow}`)) return;
            if (messageData.key?.remoteJid !== from) return;

            const responseSender = getResponseSender(messageData);
            if (from.endsWith('@g.us') && responseSender !== originalSender) return;

            // ✅ No sock.ev.off — multi-tap

            const typeChosen = selectedId.replace(prefix, '').split('_')[2]; // audio | video

            // ── AUDIO PATH ────────────────────────────────────────────────────
            if (typeChosen === 'audio') {
                const afmtDateNow = Date.now();

                await sendButtons(sock, from, {
                    title:   `🎵 AUDIO FORMAT`,
                    text:    `*Select how to receive the audio:*`,
                    footer:  `Made by ${config.botName}`,
                    buttons: getAudioFormatButtons(afmtDateNow),
                }, { quoted: messageData });

                await sock.sendMessage(from, { react: { text: '⬇️', key: msg.key } });

                const handleAudioFormat = async (event) => {
                    const fmtMsg = event.messages[0];
                    if (!fmtMsg?.message) return;

                    const fmtId = extractButtonResponseId(fmtMsg);
                    if (!fmtId) return;
                    if (!fmtId.includes('st_afmt_') || !fmtId.includes(`_${afmtDateNow}`)) return;
                    if (fmtMsg.key?.remoteJid !== from) return;

                    const fmtSender = getResponseSender(fmtMsg);
                    if (from.endsWith('@g.us') && fmtSender !== originalSender) return;

                    // ✅ No sock.ev.off — multi-tap
                    const formatType = fmtId.replace(prefix, '').split('_')[2]; // audio | audiodoc
                    await sock.sendMessage(from, { react: { text: '⏬', key: msg.key } });

                    try {
                        const apiData  = await downloadSaveTube(videoUrl, 'mp3');
                        const tempDir  = path.join(__dirname, 'temp');
                        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
                        const filePath = path.join(tempDir, `st_audio_${afmtDateNow}.mp3`);

                        const stream = await axios({
                            method: 'get', url: apiData.downloadUrl,
                            responseType: 'stream', timeout: 600000,
                        });
                        const writer = fs.createWriteStream(filePath);
                        stream.data.pipe(writer);
                        await new Promise((resolve, reject) => {
                            writer.on('finish', resolve);
                            writer.on('error', reject);
                        });

                        if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
                            throw new Error('Download failed — file is empty');
                        }

                        const rawTitle   = apiData.title || videoMeta?.title || '';
                        const cleanTitle = rawTitle.replace(/[^\w\s.-]/gi, '').substring(0, 100);

                        if (formatType === 'audio') {
                            await sock.sendMessage(from, {
                                audio:    { url: filePath },
                                mimetype: 'audio/mpeg',
                            }, { quoted: fmtMsg });
                        } else if (formatType === 'audiodoc') {
                            await sock.sendMessage(from, {
                                document: { url: filePath },
                                mimetype: 'audio/mpeg',
                                fileName: `${cleanTitle}.mp3`,
                                caption:  `🎵 ${rawTitle}\n> ${config.botName}`,
                            }, { quoted: fmtMsg });
                        }

                        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                        await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });

                    } catch (error) {
                        console.error('[savetube] audio error:', error.message);
                        await sock.sendMessage(from, { react: { text: '❌', key: msg.key } });
                        await sock.sendMessage(from, {
                            text: `🚫 Error: ${error.message}\n\n_Try again later._`,
                        }, { quoted: fmtMsg });
                    }
                };

                sock.ev.on('messages.upsert', handleAudioFormat);
                // ✅ No setTimeout — no expiry
            }

            // ── VIDEO PATH ────────────────────────────────────────────────────
            if (typeChosen === 'video') {
                const vqDateNow = Date.now();

                await sendButtons(sock, from, {
                    title:   `🎬 SELECT QUALITY`,
                    text:    `*Select video quality:*`,
                    footer:  `Made by ${config.botName}`,
                    buttons: getVideoQualityButtons(vqDateNow),
                }, { quoted: messageData });

                await sock.sendMessage(from, { react: { text: '⬇️', key: msg.key } });

                const handleQualitySelect = async (event) => {
                    const qMsg = event.messages[0];
                    if (!qMsg?.message) return;

                    const qId = extractButtonResponseId(qMsg);
                    if (!qId) return;
                    if (!qId.includes('st_vq_') || !qId.includes(`_${vqDateNow}`)) return;
                    if (qMsg.key?.remoteJid !== from) return;

                    const qSender = getResponseSender(qMsg);
                    if (from.endsWith('@g.us') && qSender !== originalSender) return;

                    // ✅ No sock.ev.off — multi-tap (user can re-pick quality)
                    const quality = qId.replace(prefix, '').split('_')[2]; // 360 | 480 | 720 | 1080

                    const vfmtDateNow = Date.now();

                    await sendButtons(sock, from, {
                        title:   `🎬 ${quality}p — SEND AS`,
                        text:    `*Quality selected:* ${quality}p\n\n*Send as:*`,
                        footer:  `Made by ${config.botName}`,
                        buttons: getVideoFormatButtons(quality, vfmtDateNow),
                    }, { quoted: qMsg });

                    await sock.sendMessage(from, { react: { text: '⬇️', key: msg.key } });

                    const handleVideoFormat = async (event) => {
                        const vfMsg = event.messages[0];
                        if (!vfMsg?.message) return;

                        const vfId = extractButtonResponseId(vfMsg);
                        if (!vfId) return;
                        if (!vfId.includes('st_vfmt_') || !vfId.includes(`_${vfmtDateNow}`)) return;
                        if (vfMsg.key?.remoteJid !== from) return;

                        const vfSender = getResponseSender(vfMsg);
                        if (from.endsWith('@g.us') && vfSender !== originalSender) return;

                        // ✅ No sock.ev.off — multi-tap
                        // ID shape: <prefix>st_vfmt_<video|videodoc>_<quality>_<dateNow>
                        const parts      = vfId.replace(prefix, '').split('_');
                        const formatType = parts[2];  // video | videodoc
                        const q          = parts[3];  // 360 | 480 | 720 | 1080

                        await sock.sendMessage(from, { react: { text: '⏬', key: msg.key } });

                        try {
                            const apiData  = await downloadSaveTube(videoUrl, q);
                            const tempDir  = path.join(__dirname, 'temp');
                            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
                            const filePath = path.join(tempDir, `st_video_${vfmtDateNow}.mp4`);

                            const stream = await axios({
                                method: 'get', url: apiData.downloadUrl,
                                responseType: 'stream', timeout: 600000,
                            });
                            const writer = fs.createWriteStream(filePath);
                            stream.data.pipe(writer);
                            await new Promise((resolve, reject) => {
                                writer.on('finish', resolve);
                                writer.on('error', reject);
                            });

                            if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
                                throw new Error('Download failed — file is empty');
                            }

                            const rawTitle   = apiData.title || videoMeta?.title || '';
                            const cleanTitle = rawTitle.replace(/[^\w\s.-]/gi, '').substring(0, 100);

                            if (formatType === 'video') {
                                await sock.sendMessage(from, {
                                    video:    { url: filePath },
                                    mimetype: 'video/mp4',
                                    caption:  `🎬 ${rawTitle} [${q}p]\n> ${config.botName}`,
                                }, { quoted: vfMsg });
                            } else if (formatType === 'videodoc') {
                                await sock.sendMessage(from, {
                                    document: { url: filePath },
                                    mimetype: 'video/mp4',
                                    fileName: `${cleanTitle}_${q}p.mp4`,
                                    caption:  `🎬 ${rawTitle} [${q}p]\n> ${config.botName}`,
                                }, { quoted: vfMsg });
                            }

                            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                            await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });

                        } catch (error) {
                            console.error('[savetube] video error:', error.message);
                            await sock.sendMessage(from, { react: { text: '❌', key: msg.key } });
                            await sock.sendMessage(from, {
                                text: `🚫 Error: ${error.message}\n\n_Try again later._`,
                            }, { quoted: vfMsg });
                        }
                    };

                    sock.ev.on('messages.upsert', handleVideoFormat);
                    // ✅ No setTimeout — no expiry
                };

                sock.ev.on('messages.upsert', handleQualitySelect);
                // ✅ No setTimeout — no expiry
            }
        };

        sock.ev.on('messages.upsert', handleTypeSelect);
        // ✅ No setTimeout — no expiry
    },
};
