/**
 * SaveYT Command — YouTube downloader
 * API: https://yt-dl.officialhectormanuel.workers.dev/?url=<youtube_url>
 */

const axios      = require('axios');
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
    const res = await axios({ method: 'get', url, responseType: 'arraybuffer', timeout: 120000 });
    const buf = Buffer.from(res.data);
    if (!buf || buf.length === 0) throw new Error('Download failed — buffer is empty');
    return buf;
}

function cleanTitle(str) {
    return (str || 'video').replace(/[^\w\s.-]/gi, '').trim().substring(0, 80);
}

// ── Button builders ───────────────────────────────────────────────────────────

function getSearchResultButtons(results, dateNow) {
    const p = config.prefix || '.';
    return results.map((r, i) => ({
        id:   `${p}ytsearch_${i}_${dateNow}`,
        text: `${i + 1}. ${r.title.substring(0, 50)}`,
    }));
}

function getQualityButtons(qualities, audioUrl, dateNow) {
    const p = config.prefix || '.';
    const labels = {
        '144':  '144p 📱',
        '240':  '240p 📱',
        '360':  '360p SD',
        '480':  '480p SD',
        '720':  '720p HD',
        '1080': '1080p FHD',
    };
    const buttons = [];

    // Audio first
    if (audioUrl) {
        buttons.push({ id: `${p}ytdl_audio_${dateNow}`, text: '🎶 Audio (mp3)' });
    }

    // Video qualities
    qualities
        .filter(q => q !== 'mp3')
        .sort((a, b) => parseInt(a) - parseInt(b))
        .forEach(q => {
            buttons.push({
                id:   `${p}ytdl_video_${q}_${dateNow}`,
                text: labels[q] || `${q}p`,
            });
        });

    return buttons;
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
    const dateNow  = Date.now();
    const label    = cleanTitle(title);
    const buttons  = getQualityButtons(available_qualities, audioUrl, dateNow);

    await sendButtons(sock, from, {
        title:   `🎬 YOUTUBE DOWNLOADER`,
        text:    `*Title:* ${title}\n\n*Select quality to download:*`,
        footer:  `Made by ${config.botName}`,
        buttons,
    }, { quoted: quotedMsg });

    await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });

    // ── Listen for quality / audio selection ──────────────────────────────────
    const handleSelect = async (event) => {
        const selMsg = event.messages[0];
        if (!selMsg?.message) return;

        const selId = extractButtonResponseId(selMsg);
        if (!selId) return;
        if (!selId.includes('ytdl_') || !selId.includes(`_${dateNow}`)) return;
        if (selMsg.key?.remoteJid !== from) return;
        if (from.endsWith('@g.us') && getResponseSender(selMsg) !== originalSender) return;

        sock.ev.off('messages.upsert', handleSelect);
        await sock.sendMessage(from, { react: { text: '⏬', key: msg.key } });

        const cleanId = selId.replace(prefix, '');

        // ── Audio ──────────────────────────────────────────────────────────────
        if (cleanId.startsWith('ytdl_audio_')) {
            try {
                const buf = await downloadToBuffer(audioUrl);
                await sock.sendMessage(from, {
                    audio:    buf,
                    mimetype: 'audio/mpeg',
                }, { quoted: selMsg });
                await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });
            } catch (err) {
                console.error('[saveyt] audio error:', err.message);
                await sock.sendMessage(from, { react: { text: '❌', key: msg.key } });
                await sock.sendMessage(from, { text: `🚫 Audio download failed: ${err.message}` }, { quoted: selMsg });
            }
            return;
        }

        // ── Video ──────────────────────────────────────────────────────────────
        const videoMatch = cleanId.match(/^ytdl_video_(\d+)_/);
        if (videoMatch) {
            const quality  = videoMatch[1];
            const videoUrl = videos[quality];

            if (!videoUrl) {
                return await sock.sendMessage(from, { text: `❌ Quality *${quality}p* is not available.` }, { quoted: selMsg });
            }

            try {
                await sock.sendMessage(from, {
                    video:    { url: videoUrl },
                    mimetype: 'video/mp4',
                    caption:  `🎬 *${title}*\n📺 Quality: ${quality}p\n> ${config.botName}`,
                }, { quoted: selMsg });
                await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });
            } catch (err) {
                console.error('[saveyt] video error:', err.message);
                await sock.sendMessage(from, { react: { text: '❌', key: msg.key } });
                await sock.sendMessage(from, { text: `🚫 Video download failed: ${err.message}` }, { quoted: selMsg });
            }
        }
    };

    sock.ev.on('messages.upsert', handleSelect);
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
                `*Qualities available:*\n` +
                `• 🎶 Audio (mp3)\n` +
                `• 🎬 144p / 240p / 360p / 480p / 720p / 1080p`
            );
        }

        await sock.sendMessage(from, { react: { text: '🔍', key: msg.key } });

        // ── Direct URL ────────────────────────────────────────────────────────
        if (isYouTubeUrl(input)) {
            return await startDownloadFlow(sock, msg, from, prefix, originalSender, input, msg);
        }

        // ── Search ────────────────────────────────────────────────────────────
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
            text:    `Query: *${input}*\n\n*Select a video:*`,
            footer:  `Made by ${config.botName}`,
            buttons: getSearchResultButtons(results, searchDateNow),
        }, { quoted: msg });

        await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });

        // ── Listen for search selection ───────────────────────────────────────
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
