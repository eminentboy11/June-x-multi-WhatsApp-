/**
 * SaveYT Command — YouTube downloader
 * API: https://yt-dl.officialhectormanuel.workers.dev/?url=<youtube_url>
 */

const axios = require('axios');
const fs    = require('fs');
const path  = require('path');
const { sendButtons } = require('gifted-btns');
const config = require('../../config');

const YT_API = 'https://yt-dl.officialhectormanuel.workers.dev/';

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

function isYouTubeUrl(str) {
    return /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\/.+/.test(str.trim());
}

async function fetchYTInfo(url) {
    const { data } = await axios.get(YT_API, {
        params:  { url },
        timeout: 30000,
    });
    if (!data?.status) throw new Error(data?.message || 'API returned an error');
    return data;
}

async function downloadToFile(url, filePath) {
    const res = await axios({ method: 'get', url, responseType: 'stream', timeout: 600000 });
    const writer = fs.createWriteStream(filePath);
    res.data.pipe(writer);
    await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
        throw new Error('Download failed — file is empty');
    }
}

function cleanTitle(str) {
    return (str || 'video').replace(/[^\w\s.-]/gi, '').trim().substring(0, 80);
}

function getTempPath(name) {
    const dir = path.join(__dirname, 'temp');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    return path.join(dir, name);
}

function safeDelete(filePath) {
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
}

// ── Button builders ───────────────────────────────────────────────────────────

function getTypeButtons(dateNow) {
    const p = config.prefix || '.';
    return [
        { id: `${p}yttype_audio_${dateNow}`,    text: '🎶 Audio'          },
        { id: `${p}yttype_audiodoc_${dateNow}`, text: '📄 Audio Document' },
        { id: `${p}yttype_video_${dateNow}`,    text: '🎬 Video'          },
    ];
}

function getQualityButtons(qualities, dateNow) {
    const p = config.prefix || '.';
    const labels = { '144': '144p 📱', '240': '240p 📱', '360': '360p SD', '480': '480p SD', '720': '720p HD', '1080': '1080p FHD' };
    return qualities
        .filter(q => q !== 'mp3')
        .sort((a, b) => parseInt(a) - parseInt(b))
        .map(q => ({
            id:   `${p}ytqual_${q}_${dateNow}`,
            text: labels[q] || `${q}p`,
        }));
}

function getVideoFormatButtons(dateNow) {
    const p = config.prefix || '.';
    return [
        { id: `${p}ytvfmt_video_${dateNow}`,    text: '🎬 Video'          },
        { id: `${p}ytvfmt_videodoc_${dateNow}`, text: '📄 Video Document' },
    ];
}

// ── Module ────────────────────────────────────────────────────────────────────

module.exports = {
    name: 'saveyt',
    aliases: ['savetube', 'ytdown', 'ytsave'],
    category: 'media',
    description: 'Download YouTube videos or audio in multiple formats and qualities',
    usage: '.saveyt <youtube url>',

    async execute(sock, msg, args, extra) {
        const from           = extra.from;
        const prefix         = config.prefix || '.';
        const originalSender = msg.key.participant || msg.key.remoteJid;

        const url = args[0]?.trim();

        if (!url || !isYouTubeUrl(url)) {
            return extra.reply(
                `🎬 *YouTube Downloader*\n\n` +
                `*Usage:* \`.saveyt <youtube url>\`\n\n` +
                `*Examples:*\n` +
                `• \`.saveyt https://youtube.com/watch?v=xxxxx\`\n` +
                `• \`.saveyt https://youtu.be/xxxxx\`\n\n` +
                `*Formats available:*\n` +
                `• 🎶 Audio (mp3)\n` +
                `• 📄 Audio Document\n` +
                `• 🎬 Video (144p — 1080p)\n` +
                `• 📄 Video Document`
            );
        }

        await sock.sendMessage(from, { react: { text: '🔍', key: msg.key } });
        await sock.sendMessage(from, { text: '⏳ _Fetching video info..._' }, { quoted: msg });

        // ── Step 1: Fetch video info ───────────────────────────────────────────
        let info;
        try {
            info = await fetchYTInfo(url);
        } catch (err) {
            console.error('[saveyt] fetch error:', err.message);
            await sock.sendMessage(from, { react: { text: '❌', key: msg.key } });
            return extra.reply(`❌ Failed to fetch video info: ${err.message}`);
        }

        const { title, thumbnail, audio: audioUrl, videos, available_qualities } = info;
        const dateNow = Date.now();

        // ── Step 2: Send type-selection buttons ───────────────────────────────
        await sendButtons(sock, from, {
            title:   `🎬 YOUTUBE DOWNLOADER`,
            text:
                `*Title:* ${title}\n\n` +
                `*Available qualities:* ${available_qualities.filter(q => q !== 'mp3').join(', ')}\n\n` +
                `*Select download type:*`,
            footer:  `Made by ${config.botName}`,
            buttons: getTypeButtons(dateNow),
        }, { quoted: msg });

        await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });

        // ── Step 3: Listen for type selection ─────────────────────────────────
        const handleTypeSelect = async (event) => {
            const typeMsg = event.messages[0];
            if (!typeMsg?.message) return;

            const typeId = extractButtonResponseId(typeMsg);
            if (!typeId) return;
            if (!typeId.includes('yttype_') || !typeId.includes(`_${dateNow}`)) return;
            if (typeMsg.key?.remoteJid !== from) return;
            if (from.endsWith('@g.us') && getResponseSender(typeMsg) !== originalSender) return;

            const typeMatch = typeId.replace(prefix, '').match(/^yttype_(\w+)_/);
            if (!typeMatch) return;
            const selectedType = typeMatch[1]; // audio | audiodoc | video

            await sock.sendMessage(from, { react: { text: '⬇️', key: msg.key } });

            // ── Audio / Audio Document ─────────────────────────────────────────
            if (selectedType === 'audio' || selectedType === 'audiodoc') {
                sock.ev.off('messages.upsert', handleTypeSelect);

                await sock.sendMessage(from, { text: '⏳ _Downloading audio..._' }, { quoted: typeMsg });

                const filePath = getTempPath(`yt_audio_${dateNow}.mp3`);
                try {
                    await downloadToFile(audioUrl, filePath);

                    const label = cleanTitle(title);

                    if (selectedType === 'audio') {
                        await sock.sendMessage(from, {
                            audio:    { url: filePath },
                            mimetype: 'audio/mpeg',
                        }, { quoted: typeMsg });
                    } else {
                        await sock.sendMessage(from, {
                            document: { url: filePath },
                            mimetype: 'audio/mpeg',
                            fileName: `${label}.mp3`,
                            caption:  `> ${config.botName}`,
                        }, { quoted: typeMsg });
                    }

                    await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });
                } catch (err) {
                    console.error('[saveyt] audio error:', err.message);
                    await sock.sendMessage(from, { react: { text: '❌', key: msg.key } });
                    await sock.sendMessage(from, { text: `🚫 Audio download failed: ${err.message}` }, { quoted: typeMsg });
                } finally {
                    safeDelete(filePath);
                }
                return;
            }

            // ── Video: send quality buttons ────────────────────────────────────
            if (selectedType === 'video') {
                const qualDateNow = Date.now();
                const qualButtons = getQualityButtons(available_qualities, qualDateNow);

                if (!qualButtons.length) {
                    await sock.sendMessage(from, { react: { text: '❌', key: msg.key } });
                    return await sock.sendMessage(from, { text: '❌ No video qualities available for this video.' }, { quoted: typeMsg });
                }

                await sendButtons(sock, from, {
                    title:   `🎬 SELECT QUALITY`,
                    text:
                        `*Title:* ${title}\n\n` +
                        `*Select video quality:*`,
                    footer:  `Made by ${config.botName}`,
                    buttons: qualButtons,
                }, { quoted: typeMsg });

                // ── Step 4: Listen for quality selection ──────────────────────
                const handleQualSelect = async (qEvent) => {
                    const qualMsg = qEvent.messages[0];
                    if (!qualMsg?.message) return;

                    const qualId = extractButtonResponseId(qualMsg);
                    if (!qualId) return;
                    if (!qualId.includes('ytqual_') || !qualId.includes(`_${qualDateNow}`)) return;
                    if (qualMsg.key?.remoteJid !== from) return;
                    if (from.endsWith('@g.us') && getResponseSender(qualMsg) !== originalSender) return;

                    const qualMatch = qualId.replace(prefix, '').match(/^ytqual_(\d+)_/);
                    if (!qualMatch) return;
                    const quality = qualMatch[1];
                    const videoUrl = videos[quality];

                    if (!videoUrl) {
                        return await sock.sendMessage(from, { text: `❌ Quality *${quality}p* is not available.` }, { quoted: qualMsg });
                    }

                    sock.ev.off('messages.upsert', handleQualSelect);

                    // ── Step 5: Send video format buttons ──────────────────────
                    const fmtDateNow = Date.now();

                    await sendButtons(sock, from, {
                        title:   `🎬 SELECT FORMAT`,
                        text:
                            `*Title:* ${title}\n` +
                            `*Quality:* ${quality}p\n\n` +
                            `*Select download format:*`,
                        footer:  `Made by ${config.botName}`,
                        buttons: getVideoFormatButtons(fmtDateNow),
                    }, { quoted: qualMsg });

                    await sock.sendMessage(from, { react: { text: '⬇️', key: msg.key } });

                    // ── Step 6: Listen for video format selection ──────────────
                    const handleVideoFmt = async (fmtEvent) => {
                        const fmtMsg = fmtEvent.messages[0];
                        if (!fmtMsg?.message) return;

                        const fmtId = extractButtonResponseId(fmtMsg);
                        if (!fmtId) return;
                        if (!fmtId.includes('ytvfmt_') || !fmtId.includes(`_${fmtDateNow}`)) return;
                        if (fmtMsg.key?.remoteJid !== from) return;
                        if (from.endsWith('@g.us') && getResponseSender(fmtMsg) !== originalSender) return;

                        const fmtMatch = fmtId.replace(prefix, '').match(/^ytvfmt_(\w+)_/);
                        if (!fmtMatch) return;
                        const videoFmt = fmtMatch[1]; // video | videodoc

                        sock.ev.off('messages.upsert', handleVideoFmt);

                        await sock.sendMessage(from, { react: { text: '⏬', key: msg.key } });
                        await sock.sendMessage(from, { text: `⏳ _Downloading ${quality}p video..._` }, { quoted: fmtMsg });

                        const ext      = 'mp4';
                        const filePath = getTempPath(`yt_video_${quality}_${fmtDateNow}.${ext}`);

                        try {
                            await downloadToFile(videoUrl, filePath);

                            const label = cleanTitle(title);

                            if (videoFmt === 'video') {
                                await sock.sendMessage(from, {
                                    video:    { url: filePath },
                                    mimetype: 'video/mp4',
                                    caption:  `🎬 *${title}*\n📺 Quality: ${quality}p\n> ${config.botName}`,
                                }, { quoted: fmtMsg });
                            } else {
                                await sock.sendMessage(from, {
                                    document: { url: filePath },
                                    mimetype: 'video/mp4',
                                    fileName: `${label}_${quality}p.mp4`,
                                    caption:  `🎬 *${title}*\n📺 Quality: ${quality}p\n> ${config.botName}`,
                                }, { quoted: fmtMsg });
                            }

                            await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });
                        } catch (err) {
                            console.error('[saveyt] video error:', err.message);
                            await sock.sendMessage(from, { react: { text: '❌', key: msg.key } });
                            await sock.sendMessage(from, { text: `🚫 Video download failed: ${err.message}` }, { quoted: fmtMsg });
                        } finally {
                            safeDelete(filePath);
                        }
                    };

                    sock.ev.on('messages.upsert', handleVideoFmt);
                };

                sock.ev.on('messages.upsert', handleQualSelect);
            }
        };

        sock.ev.on('messages.upsert', handleTypeSelect);
    },
};
