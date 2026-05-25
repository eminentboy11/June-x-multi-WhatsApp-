/**
 * SoundCloud Command — powered by api.nexray.eu.cc
 * Search:   GET /search/soundcloud?q=<query>
 * Download: GET /downloader/soundcloud?url=<soundcloud_url>
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { sendButtons } = require('gifted-btns');
const config = require('../../config');

const RETRY_DELAY = 3000;
const MAX_RESULTS = 5;
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

function isSoundCloudUrl(text) {
    return /https?:\/\/(www\.|m\.)?soundcloud\.com\/[^\s]+/i.test(text);
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

/**
 * Search SoundCloud
 * Response: { status, result: [ { id, title, url, duration, thumbnail,
 *             author: { name, url }, like_count, play_count, release_date } ] }
 */
async function searchSoundCloud(query) {
    return withRetry(async () => {
        const res = await axios.get(
            `${BASE}/search/soundcloud?q=${encodeURIComponent(query)}`,
            { timeout: 30000 }
        );
        if (!res.data?.status || !Array.isArray(res.data?.result) || !res.data.result.length) {
            throw new Error('No results found');
        }
        return res.data.result.slice(0, MAX_RESULTS);
    });
}

/**
 * Download SoundCloud track by its URL
 * Response: { status, result: { title, download_url, thumbnail, duration, ... } }
 */
async function downloadSoundCloud(trackUrl) {
    return withRetry(async () => {
        console.log('[soundcloud] downloading:', trackUrl);
        const res = await axios.get(
            `${BASE}/downloader/soundcloud?url=${encodeURIComponent(trackUrl)}`,
            { timeout: 90000 }
        );
        const result = res.data?.result;
        if (!res.data?.status || !result?.download_url) {
            throw new Error('Download API returned no URL');
        }
        console.log('[soundcloud] delivering:', result.title);
        return {
            downloadUrl: result.download_url,
            title:       result.title     || '',
            thumbnail:   result.thumbnail || '',
            duration:    result.duration  || '',
        };
    });
}

/**
 * Track-selection buttons — one per search result
 * ID: <prefix>sctrack_<index>_<dateNow>
 */
function getTrackButtons(tracks, dateNow) {
    const prefix = config.prefix || '.';
    return tracks.map((track, i) => ({
        id:   `${prefix}sctrack_${i}_${dateNow}`,
        text: `${i + 1}. ${track.title.substring(0, 22)}${track.title.length > 22 ? '…' : ''}`,
    }));
}

/**
 * Format buttons after a track is chosen
 * ID: <prefix>scfmt_<format>_<dateNow>
 */
function getFormatButtons(dateNow) {
    const prefix = config.prefix || '.';
    return [
        { id: `${prefix}scfmt_audio_${dateNow}`,    text: '🎶 Audio' },
        { id: `${prefix}scfmt_audiodoc_${dateNow}`, text: '📄 Audio Document' },
    ];
}

// ── Module ────────────────────────────────────────────────────────────────────

module.exports = {
    name: 'soundcloud',
    aliases: ['sc', 'scdl', 'scplay'],
    category: 'media',
    description: 'Search and download SoundCloud tracks',
    usage: '.soundcloud <track name | soundcloud link>',

    async execute(sock, msg, args, extra) {
        if (!args.length) {
            return extra.reply(
                `🎧 *SoundCloud Downloader*\n\n` +
                `*Usage:*\n` +
                `• \`.soundcloud faded\` — search by name\n` +
                `• \`.soundcloud https://soundcloud.com/...\` — download via link\n` +
                `• Reply to a message with \`.soundcloud\` — use replied text as query`
            );
        }

        let query = args.join(' ').trim();

        if (!query) {
            const quoted = extra?.quoted;
            query = quoted?.conversation || quoted?.extendedTextMessage?.text || '';
        }

        if (!query) {
            return extra.reply('🎧 Provide a track name or SoundCloud link.\nExample: `.soundcloud Faded`');
        }

        if (query.length > 200) {
            return extra.reply('📝 Query too long! Max 200 chars.');
        }

        const from           = extra.from;
        const prefix         = config.prefix || '.';
        const originalSender = msg.key.participant || msg.key.remoteJid;

        // ── Direct SoundCloud URL — skip search, straight to format buttons ──
        if (isSoundCloudUrl(query)) {
            await sock.sendMessage(from, { react: { text: '🔗', key: msg.key } });

            const fmtDateNow = Date.now();

            await sendButtons(sock, from, {
                title:   `🎧 SOUNDCLOUD LINK`,
                text:
                    `⿻ *Link:* ${query}\n\n` +
                    `*Select download format:*`,
                footer:  `Made by ${config.botName}`,
                buttons: getFormatButtons(fmtDateNow),
            }, { quoted: msg });

            await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });

            // Listen for format — persistent, no expiry, multi-tap
            const handleDirectFormat = async (event) => {
                const fmtMsg = event.messages[0];
                if (!fmtMsg?.message) return;

                const fmtId = extractButtonResponseId(fmtMsg);
                if (!fmtId) return;
                if (!fmtId.includes('scfmt_') || !fmtId.includes(`_${fmtDateNow}`)) return;
                if (fmtMsg.key?.remoteJid !== from) return;

                const fmtSender = getResponseSender(fmtMsg);
                if (from.endsWith('@g.us') && fmtSender !== originalSender) return;

                // ✅ No sock.ev.off — multi-tap
                const formatType = fmtId.replace(prefix, '').split('_')[1];
                await sock.sendMessage(from, { react: { text: '⏬', key: msg.key } });

                try {
                    const apiData  = await downloadSoundCloud(query);
                    const tempDir  = path.join(__dirname, 'temp');
                    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
                    const filePath = path.join(tempDir, `sc_${fmtDateNow}.mp3`);

                    const audioStream = await axios({
                        method: 'get', url: apiData.downloadUrl,
                        responseType: 'stream', timeout: 600000,
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

                    const cleanTitle = (apiData.title || '').replace(/[^\w\s.-]/gi, '').substring(0, 100);

                    if (formatType === 'audio') {
                        await sock.sendMessage(from, {
                            audio: { url: filePath },
                            mimetype: 'audio/mpeg',
                        }, { quoted: fmtMsg });
                    } else if (formatType === 'audiodoc') {
                        await sock.sendMessage(from, {
                            document: { url: filePath },
                            mimetype: 'audio/mpeg',
                            fileName: `${cleanTitle}.mp3`,
                            caption:  `🎧 ${apiData.title}\n> ${config.botName}`,
                        }, { quoted: fmtMsg });
                    }

                    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                    await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });

                } catch (error) {
                    console.error('[soundcloud] link download error:', error.message);
                    await sock.sendMessage(from, { react: { text: '❌', key: msg.key } });
                    await sock.sendMessage(from, {
                        text: `🚫 Error: ${error.message}\n\n_Try again later._`,
                    }, { quoted: fmtMsg });
                }
            };

            sock.ev.on('messages.upsert', handleDirectFormat);
            // ✅ No setTimeout — no expiry
            return;
        }

        // ── Search flow ───────────────────────────────────────────────────────
        await sock.sendMessage(from, { react: { text: '🔍', key: msg.key } });

        let tracks;
        try {
            tracks = await searchSoundCloud(query);
        } catch (e) {
            console.error('[soundcloud] search error:', e.message);
            return extra.reply(`❌ Search failed: ${e.message}`);
        }

        const dateNow = Date.now();

        // Build track list using actual response fields: author.name, like_count, play_count
        const trackList = tracks.map((t, i) =>
            `*${i + 1}.* ${t.title}\n` +
            `    🎤 ${t.author?.name || 'N/A'}  •  ⏱ ${t.duration || 'N/A'}\n` +
            `    ❤️ ${t.like_count || '0'}  •  ▶️ ${t.play_count || '0'}`
        ).join('\n\n');

        // ── Step 2: Send track-selection buttons ──────────────────────────────
        await sendButtons(sock, from, {
            title:   `🎧 SOUNDCLOUD SEARCH`,
            text:
                `*Query:* _${query}_\n\n` +
                `${trackList}\n\n` +
                `*Select a track to download:*`,
            footer:  `Made by ${config.botName}`,
            buttons: getTrackButtons(tracks, dateNow),
        }, { quoted: msg });

        await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });

        // ── Step 3: Track selection — persistent, multi-tap ───────────────────
        const handleTrackSelect = async (event) => {
            const messageData = event.messages[0];
            if (!messageData?.message) return;

            const selectedId = extractButtonResponseId(messageData);
            if (!selectedId) return;
            if (!selectedId.includes('sctrack_') || !selectedId.includes(`_${dateNow}`)) return;
            if (messageData.key?.remoteJid !== from) return;

            const responseSender = getResponseSender(messageData);
            if (from.endsWith('@g.us') && responseSender !== originalSender) return;

            // ✅ No sock.ev.off — allows picking different tracks repeatedly

            const match = selectedId.replace(prefix, '').match(/^sctrack_(\d+)_/);
            if (!match) return;
            const track = tracks[parseInt(match[1])];
            if (!track) return;

            // ── Step 4: Format buttons ────────────────────────────────────────
            const fmtDateNow = Date.now();

            await sendButtons(sock, from, {
                title:   `🎧 ${track.title}`,
                text:
                    `⿻ *Title:*    ${track.title}\n` +
                    `⿻ *Artist:*   ${track.author?.name  || 'N/A'}\n` +
                    `⿻ *Duration:* ${track.duration      || 'N/A'}\n` +
                    `⿻ *Likes:*    ${track.like_count    || '0'}\n` +
                    `⿻ *Plays:*    ${track.play_count    || '0'}\n` +
                    `⿻ *Released:* ${track.release_date  || 'N/A'}\n` +
                    `⿻ *Link:*     ${track.url           || 'N/A'}\n\n` +
                    `*Select download format:*`,
                footer:  `Made by ${config.botName}`,
                buttons: getFormatButtons(fmtDateNow),
            }, { quoted: messageData });

            await sock.sendMessage(from, { react: { text: '⬇️', key: msg.key } });

            // ── Step 5: Format selection — persistent, multi-tap ──────────────
            const handleFormatSelect = async (fmtEvent) => {
                const fmtMsg = fmtEvent.messages[0];
                if (!fmtMsg?.message) return;

                const fmtId = extractButtonResponseId(fmtMsg);
                if (!fmtId) return;
                if (!fmtId.includes('scfmt_') || !fmtId.includes(`_${fmtDateNow}`)) return;
                if (fmtMsg.key?.remoteJid !== from) return;

                const fmtSender = getResponseSender(fmtMsg);
                if (from.endsWith('@g.us') && fmtSender !== originalSender) return;

                // ✅ No sock.ev.off — multi-tap allowed

                const formatType = fmtId.replace(prefix, '').split('_')[1];
                await sock.sendMessage(from, { react: { text: '⏬', key: msg.key } });

                // ── Step 6: Download & send ───────────────────────────────────
                try {
                    if (!track.url || !isSoundCloudUrl(track.url)) {
                        throw new Error('Track has no valid SoundCloud URL');
                    }

                    const apiData  = await downloadSoundCloud(track.url);
                    const tempDir  = path.join(__dirname, 'temp');
                    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
                    const filePath = path.join(tempDir, `sc_${fmtDateNow}.mp3`);

                    const audioStream = await axios({
                        method: 'get', url: apiData.downloadUrl,
                        responseType: 'stream', timeout: 600000,
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

                    const rawTitle   = apiData.title || track.title || '';
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
                            caption:  `🎧 ${rawTitle}\n> ${config.botName}`,
                        }, { quoted: fmtMsg });
                    }

                    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                    await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });

                } catch (error) {
                    console.error('[soundcloud] download error:', error.message);
                    await sock.sendMessage(from, { react: { text: '❌', key: msg.key } });
                    await sock.sendMessage(from, {
                        text: `🚫 Error: ${error.message}\n\n_Try again later._`,
                    }, { quoted: fmtMsg });
                }
            };

            sock.ev.on('messages.upsert', handleFormatSelect);
            // ✅ No setTimeout — no expiry
        };

        sock.ev.on('messages.upsert', handleTrackSelect);
        // ✅ No setTimeout — no expiry
    },
};
