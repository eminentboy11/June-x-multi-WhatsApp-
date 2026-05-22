/**
 * Spotify Command — powered by api.nexray.eu.cc
 * Search: GET /search/spotify?q=<query>
 * Download: GET /downloader/spotifyplay?q=<spotify_url>
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { sendButtons } = require('gifted-btns');
const config = require('../../config');

const RETRY_DELAY = 3000;
const MAX_RESULTS = 5;

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

/** Returns true if the input looks like a Spotify track/album/playlist URL */
function isSpotifyUrl(text) {
    return /https?:\/\/(open\.)?spotify\.com\/(track|album|playlist)\/[A-Za-z0-9]+/i.test(text);
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
 * Search Spotify — returns top MAX_RESULTS tracks
 */
async function searchSpotify(query) {
    return withRetry(async () => {
        const res = await axios.get(
            `https://api.nexray.eu.cc/search/spotify?q=${encodeURIComponent(query)}`,
            { timeout: 30000 }
        );
        if (!res.data?.status || !Array.isArray(res.data?.result) || !res.data.result.length) {
            throw new Error('No results found');
        }
        return res.data.result.slice(0, MAX_RESULTS);
    });
}

/**
 * Download Spotify track — accepts either a Spotify URL or a search string
 */
async function downloadSpotify(spotifyUrlOrQuery) {
    return withRetry(async () => {
        const res = await axios.get(
            `https://api.nexray.eu.cc/downloader/spotifyplay?q=${encodeURIComponent(spotifyUrlOrQuery)}`,
            { timeout: 90000 }
        );
        const result = res.data?.result;
        if (!res.data?.status || !result?.download_url) {
            throw new Error('Download API returned no URL');
        }
        return {
            downloadUrl: result.download_url,
            title:       result.title     || '',
            artist:      result.artist    || '',
            album:       result.album     || '',
            duration:    result.duration  || '',
            thumbnail:   result.thumbnail || '',
        };
    });
}

/**
 * Build track-selection buttons (one per search result)
 */
function getTrackButtons(tracks, dateNow) {
    const prefix = config.prefix || '.';
    return tracks.map((track, i) => ({
        id:   `${prefix}sptrack_${i}_${dateNow}`,
        text: `${i + 1}. ${track.title.substring(0, 22)}${track.title.length > 22 ? '…' : ''}`,
    }));
}

/**
 * Build format buttons after a track is chosen
 */
function getFormatButtons(dateNow) {
    const prefix = config.prefix || '.';
    return [
        { id: `${prefix}spfmt_audio_${dateNow}`,    text: '🎶 Audio' },
        { id: `${prefix}spfmt_audiodoc_${dateNow}`, text: '📄 Audio Document' },
    ];
}

/**
 * Download, save to temp, and send audio based on formatType ('audio' | 'audiodoc')
 */
async function sendAudio({ sock, from, msg, messageData, downloadQuery, trackMeta, formatType, prefix }) {
    await sock.sendMessage(from, { react: { text: '⏬', key: msg.key } });

    const apiData = await downloadSpotify(downloadQuery);

    const tempDir  = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
    const filePath = path.join(tempDir, `sp_${Date.now()}.mp3`);

    const audioStream = await axios({
        method:       'get',
        url:          apiData.downloadUrl,
        responseType: 'stream',
        timeout:      600000,
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

    const rawTitle   = apiData.title || trackMeta?.title || '';
    const cleanTitle = rawTitle.replace(/[^\w\s.-]/gi, '').substring(0, 100);

    if (formatType === 'audio') {
        await sock.sendMessage(from, {
            audio:    { url: filePath },
            mimetype: 'audio/mpeg',
        }, { quoted: messageData });

    } else if (formatType === 'audiodoc') {
        await sock.sendMessage(from, {
            document: { url: filePath },
            mimetype: 'audio/mpeg',
            fileName: `${cleanTitle}.mp3`,
            caption:  `> ${config.botName}`,
        }, { quoted: messageData });
    }

    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });
}

// ── Module ────────────────────────────────────────────────────────────────────

module.exports = {
    name: 'spotify2',
    aliases: ['sp2', 'spdl2', 'spplay2'],
    category: 'media',
    description: 'Search and download Spotify songs',
    usage: '.spotify <song name | spotify link>',

    async execute(sock, msg, args, extra) {
        if (!args.length) {
            return extra.reply(
                `🎵 *Spotify Downloader*\n\n` +
                `*Usage:*\n` +
                `• \`.spotify faded\` — search by name\n` +
                `• \`.spotify https://open.spotify.com/track/...\` — download via link\n` +
                `• Reply to a message with \`.spotify\` — use replied text as query`
            );
        }

        let query = args.join(' ').trim();

        if (!query) {
            const quoted = extra?.quoted;
            query = quoted?.conversation || quoted?.extendedTextMessage?.text || '';
        }

        if (!query) {
            return extra.reply('🎵 Provide a song name or Spotify link.\nExample: `.spotify Faded`');
        }

        if (query.length > 200) {
            return extra.reply('📝 Query too long! Max 200 chars.');
        }

        const from           = extra.from;
        const prefix         = config.prefix || '.';
        const originalSender = msg.key.participant || msg.key.remoteJid;

        // ── Direct Spotify URL — skip search, go straight to format buttons ──
        if (isSpotifyUrl(query)) {
            await sock.sendMessage(from, { react: { text: '🔗', key: msg.key } });

            const fmtDateNow = Date.now();

            await sendButtons(sock, from, {
                title:   `🎵 SPOTIFY LINK`,
                text:
                    `⿻ *Link:* ${query}\n\n` +
                    `*Select download format:*`,
                footer:  `Made by ${config.botName}`,
                buttons: getFormatButtons(fmtDateNow),
            }, { quoted: msg });

            await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });

            // Listen for format selection — persistent, no expiry, multi-tap
            const handleDirectFormat = async (event) => {
                const fmtMsg = event.messages[0];
                if (!fmtMsg?.message) return;

                const fmtId = extractButtonResponseId(fmtMsg);
                if (!fmtId) return;
                if (!fmtId.includes('spfmt_') || !fmtId.includes(`_${fmtDateNow}`)) return;
                if (fmtMsg.key?.remoteJid !== from) return;

                const fmtSender = getResponseSender(fmtMsg);
                if (from.endsWith('@g.us') && fmtSender !== originalSender) return;

                // ✅ No sock.ev.off — multi-tap allowed
                const formatType = fmtId.replace(prefix, '').split('_')[1];

                try {
                    await sendAudio({
                        sock, from, msg,
                        messageData:   fmtMsg,
                        downloadQuery: query,       // pass the raw Spotify URL directly
                        trackMeta:     null,
                        formatType,
                        prefix,
                    });
                } catch (error) {
                    console.error('[spotify] link download error:', error.message);
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
            tracks = await searchSpotify(query);
        } catch (e) {
            console.error('[spotify] search error:', e.message);
            return extra.reply(`❌ Search failed: ${e.message}`);
        }

        const dateNow = Date.now();

        const trackList = tracks.map((t, i) =>
            `*${i + 1}.* ${t.title}\n` +
            `    ⏱ ${t.duration}  •  🔥 ${t.popularity ?? 'N/A'}  •  💿 ${t.album}`
        ).join('\n\n');

        // ── Step 2: Send track-selection buttons ──────────────────────────────
        await sendButtons(sock, from, {
            title:   `🎵 SPOTIFY SEARCH`,
            text:
                `*Query:* _${query}_\n\n` +
                `${trackList}\n\n` +
                `*Select a track to download:*`,
            footer:  `Made by ${config.botName}`,
            buttons: getTrackButtons(tracks, dateNow),
        }, { quoted: msg });

        await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });

        // ── Step 3: Listen for track selection — persistent, multi-tap ────────
        const handleTrackSelect = async (event) => {
            const messageData = event.messages[0];
            if (!messageData?.message) return;

            const selectedId = extractButtonResponseId(messageData);
            if (!selectedId) return;
            if (!selectedId.includes('sptrack_') || !selectedId.includes(`_${dateNow}`)) return;
            if (messageData.key?.remoteJid !== from) return;

            const responseSender = getResponseSender(messageData);
            if (from.endsWith('@g.us') && responseSender !== originalSender) return;

            // ✅ No sock.ev.off — allows picking a different track repeatedly

            const match = selectedId.replace(prefix, '').match(/^sptrack_(\d+)_/);
            if (!match) return;
            const trackIndex = parseInt(match[1]);
            const track      = tracks[trackIndex];
            if (!track) return;

            // ── Step 4: Send format-selection buttons ─────────────────────────
            const fmtDateNow = Date.now();

            await sendButtons(sock, from, {
                title:   `🎵 ${track.title}`,
                text:
                    `⿻ *Title:*    ${track.title}\n` +
                    `⿻ *Artist:*   ${track.artist}\n` +
                    `⿻ *Album:*    ${track.album}\n` +
                    `⿻ *Duration:* ${track.duration}\n` +
                    `⿻ *Released:* ${track.release_date || 'N/A'}\n` +
                    `⿻ *Link:*     ${track.url}\n\n` +
                    `*Select download format:*`,
                footer:  `Made by ${config.botName}`,
                buttons: getFormatButtons(fmtDateNow),
            }, { quoted: messageData });

            await sock.sendMessage(from, { react: { text: '⬇️', key: msg.key } });

            // ── Step 5: Listen for format selection — persistent, multi-tap ───
            const handleFormatSelect = async (fmtEvent) => {
                const fmtMsg = fmtEvent.messages[0];
                if (!fmtMsg?.message) return;

                const fmtId = extractButtonResponseId(fmtMsg);
                if (!fmtId) return;
                if (!fmtId.includes('spfmt_') || !fmtId.includes(`_${fmtDateNow}`)) return;
                if (fmtMsg.key?.remoteJid !== from) return;

                const fmtSender = getResponseSender(fmtMsg);
                if (from.endsWith('@g.us') && fmtSender !== originalSender) return;

                // ✅ No sock.ev.off — multi-tap allowed
                const formatType = fmtId.replace(prefix, '').split('_')[1];

                try {
                    await sendAudio({
                        sock, from, msg,
                        messageData:   fmtMsg,
                        downloadQuery: track.url,   // use the track's Spotify URL
                        trackMeta:     track,
                        formatType,
                        prefix,
                    });
                } catch (error) {
                    console.error('[spotify] download error:', error.message);
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
