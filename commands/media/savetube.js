/**
 * SaveYT Command — YouTube downloader
 * API: https://yt-dl.officialhectormanuel.workers.dev/?url=<youtube_url>
 */

const axios      = require('axios');
const fs         = require('fs');
const path       = require('path');
const yts        = require('yt-search');
const { sendButtons } = require('gifted-btns');
const config     = require('../../config');

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

async function searchYouTube(query) {
    const { videos } = await yts(query);
    if (!videos?.length) throw new Error('No results found');
    return videos.slice(0, 5).map(v => ({
        id:    v.videoId,
        title: v.title,
        url:   v.url,
    }));
}

async function fetchYTInfo(url) {
    const { data } = await axios.get(YT_API, {
        params:  { url },
        timeout: 30000,
    });
    if (!data?.status) throw new Error(data?.message || 'API returned an error');
    return data;
}

async function downloadToBuffer(url) {
    const res = await axios({ method: 'get', url, responseType: 'arraybuffer', timeout: 600000 });
    const buf = Buffer.from(res.data);
    if (!buf || buf.length === 0) throw new Error('Download failed — buffer is empty');
    return buf;
}

function cleanTitle(str) {
    return (str || 'video').replace(/[^\w\s.-]/gi, '').trim().substring(0, 80);
}

function safeDelete(filePath) {
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
}

// ── Button builders ───────────────────────────────────────────────────────────

function getSearchResultButtons(results, dateNow) {
    const p = config.prefix || '.';
    return results.map((r, i) => ({
        id:   `${p}ytsearch_${i}_${dateNow}`,
        text: `${i + 1}. ${r.title.substring(0, 50)}`,
    }));
}

function getTypeButtons(dateNow) {
    const p = config.prefix || '.';
    return [
        { id: `${p}yttype_audio_${dateNow}`,    text: '🎶 Audio'          },
        { id: `${p}yttype_audiodoc_${dateNow}`, text: '📄 Audio Document' },
        { id: `${p}yttype_video_${dateNow}`,    text: '🎬 Video'          },
        { id: `${p}yttype_videodoc_${dateNow}`, text: '📄 Video Document' },
    ];
}

function getQualityButtons(qualities, dateNow) {
    const p = config.prefix || '.';
    const labels = {
        '144':  '144p 📱',
        '240':  '240p 📱',
        '360':  '360p SD',
        '480':  '480p SD',
        '720':  '720p HD',
        '1080': '1080p FHD',
    };
    return qualities
        .filter(q => q !== 'mp3')
        .sort((a, b) => parseInt(a) - parseInt(b))
        .map(q => ({
            id:   `${p}ytqual_${q}_${dateNow}`,
            text: labels[q] || `${q}p`,
        }));
}

// ── Core download flow ────────────────────────────────────────────────────────

async function startDownloadFlow(sock, msg, from, prefix, originalSender, url, quotedMsg) {
    let info;
    try {
        info = await fetchYTInfo(url);
    } catch (err) {
        console.error('[saveyt] fetch error:', err.message);
        await sock.sendMessage(from, { react: { text: '❌', key: msg.key } });
        return await sock.sendMessage(from, { text: `❌ Failed to fetch video info: ${err.message}` }, { quoted: quotedMsg });
    }

    const { title, audio: audioUrl, videos, available_qualities } = info;
    const dateNow = Date.now();

    await sendButtons(sock, from, {
        title:   `🎬 YOUTUBE DOWNLOADER`,
        text:
            `*Title:* ${title}\n\n` +
            `*Available qualities:* ${available_qualities.filter(q => q !== 'mp3').join(', ')}\n\n` +
            `*Select download type:*`,
        footer:  `Made by ${config.botName}`,
        buttons: getTypeButtons(dateNow),
    }, { quoted: quotedMsg });

    await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });

    // ── Listen for type selection ──────────────────────────────────────────────
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
        const selectedType = typeMatch[1];

        sock.ev.off('messages.upsert', handleTypeSelect);
        await sock.sendMessage(from, { react: { text: '⬇️', key: msg.key } });

        // ── Audio / Audio Document ─────────────────────────────────────────────
        if (selectedType === 'audio' || selectedType === 'audiodoc') {
            try {
                const buf   = await downloadToBuffer(audioUrl);
                const label = cleanTitle(title);

                if (selectedType === 'audio') {
                    await sock.sendMessage(from, {
                        audio:    buf,
                        mimetype: 'audio/mpeg',
                    }, { quoted: typeMsg });
                } else {
                    await sock.sendMessage(from, {
                        document: buf,
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
            }
            return;
        }

        // ── Video / Video Document: quality buttons ────────────────────────────
        if (selectedType === 'video' || selectedType === 'videodoc') {
            const qualDateNow = Date.now();
            const qualButtons = getQualityButtons(available_qualities, qualDateNow);

            if (!qualButtons.length) {
                await sock.sendMessage(from, { react: { text: '❌', key: msg.key } });
                return await sock.sendMessage(from, { text: '❌ No video qualities available for this video.' }, { quoted: typeMsg });
            }

            await sendButtons(sock, from, {
                title:   `🎬 SELECT QUALITY`,
                text:    `*Title:* ${title}\n\n*Select video quality:*`,
                footer:  `Made by ${config.botName}`,
                buttons: qualButtons,
            }, { quoted: typeMsg });

            // ── Listen for quality selection ───────────────────────────────────
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
                const quality  = qualMatch[1];
                const videoUrl = videos[quality];

                if (!videoUrl) {
                    return await sock.sendMessage(from, { text: `❌ Quality *${quality}p* is not available.` }, { quoted: qualMsg });
                }

                sock.ev.off('messages.upsert', handleQualSelect);
                await sock.sendMessage(from, { react: { text: '⏬', key: msg.key } });

                try {
                    const buf   = await downloadToBuffer(videoUrl);
                    const label = cleanTitle(title);

                    if (selectedType === 'video') {
                        await sock.sendMessage(from, {
                            video:    buf,
                            mimetype: 'video/mp4',
                            caption:  `🎬 *${title}*\n📺 Quality: ${quality}p\n> ${config.botName}`,
                        }, { quoted: qualMsg });
                    } else {
                        await sock.sendMessage(from, {
                            document: buf,
                            mimetype: 'video/mp4',
                            fileName: `${label}_${quality}p.mp4`,
                            caption:  `🎬 *${title}*\n📺 Quality: ${quality}p\n> ${config.botName}`,
                        }, { quoted: qualMsg });
                    }

                    await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });
                } catch (err) {
                    console.error('[saveyt] video error:', err.message);
                    await sock.sendMessage(from, { react: { text: '❌', key: msg.key } });
                    await sock.sendMessage(from, { text: `🚫 Video download failed: ${err.message}` }, { quoted: qualMsg });
                }
            };

            sock.ev.on('messages.upsert', handleQualSelect);
        }
    };

    sock.ev.on('messages.upsert', handleTypeSelect);
}

// ── Module ────────────────────────────────────────────────────────────────────

module.exports = {
    name: 'saveyt',
    aliases: ['savetube', 'ytdown', 'ytsave'],
    category: 'media',
    description: 'Download YouTube videos or audio by URL or search query',
    usage: '.saveyt <youtube url or search query>',

    async execute(sock, msg, args, extra) {
        const from           = extra.from;
        const prefix         = config.prefix || '.';
        const originalSender = msg.key.participant || msg.key.remoteJid;

        const input = args.join(' ').trim();

        if (!input) {
            return extra.reply(
                `🎬 *YouTube Downloader*\n\n` +
                `*Usage:* \`.saveyt <url or search query>\`\n\n` +
                `*Examples:*\n` +
                `• \`.saveyt https://youtu.be/xxxxx\`\n` +
                `• \`.saveyt never gonna give you up\`\n\n` +
                `*Formats available:*\n` +
                `• 🎶 Audio (mp3)\n` +
                `• 📄 Audio Document\n` +
                `• 🎬 Video (144p — 1080p)\n` +
                `• 📄 Video Document`
            );
        }

        await sock.sendMessage(from, { react: { text: '🔍', key: msg.key } });

        // ── Direct URL ────────────────────────────────────────────────────────
        if (isYouTubeUrl(input)) {
            return await startDownloadFlow(sock, msg, from, prefix, originalSender, input, msg);
        }

        // ── Search query ──────────────────────────────────────────────────────
        let results;
        try {
            results = await searchYouTube(input);
        } catch (err) {
            console.error('[saveyt] search error:', err.message);
            await sock.sendMessage(from, { react: { text: '❌', key: msg.key } });
            return await sock.sendMessage(from, { text: `❌ Search failed: ${err.message}` }, { quoted: msg });
        }

        const searchDateNow = Date.now();

        await sendButtons(sock, from, {
            title:   `🔎 YOUTUBE SEARCH RESULTS`,
            text:    `Query: *${input}*\n\n*Select a video to download:*`,
            footer:  `Made by ${config.botName}`,
            buttons: getSearchResultButtons(results, searchDateNow),
        }, { quoted: msg });

        await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });

        // ── Listen for search result selection ────────────────────────────────
        const handleSearchSelect = async (event) => {
            const searchMsg = event.messages[0];
            if (!searchMsg?.message) return;

            const searchId = extractButtonResponseId(searchMsg);
            if (!searchId) return;
            if (!searchId.includes('ytsearch_') || !searchId.includes(`_${searchDateNow}`)) return;
            if (searchMsg.key?.remoteJid !== from) return;
            if (from.endsWith('@g.us') && getResponseSender(searchMsg) !== originalSender) return;

            const searchMatch = searchId.replace(prefix, '').match(/^ytsearch_(\d+)_/);
            if (!searchMatch) return;
            const idx    = parseInt(searchMatch[1]);
            const picked = results[idx];
            if (!picked) return;

            sock.ev.off('messages.upsert', handleSearchSelect);

            await sock.sendMessage(from, { react: { text: '🎬', key: msg.key } });
            await startDownloadFlow(sock, msg, from, prefix, originalSender, picked.url, searchMsg);
        };

        sock.ev.on('messages.upsert', handleSearchSelect);
    },
};
