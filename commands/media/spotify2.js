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

async function downloadSpotify(spotifyUrl) {
    return withRetry(async () => {
        const res = await axios.get(
            `https://api.nexray.eu.cc/downloader/spotifyplay?q=${encodeURIComponent(spotifyUrl)}`,
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

function getTrackButtons(tracks, dateNow) {
    const prefix = config.prefix || '.';
    return tracks.map((track, i) => ({
        id:   `${prefix}sptrack_${i}_${dateNow}`,
        text: `${i + 1}. ${track.title.substring(0, 22)}${track.title.length > 22 ? '…' : ''}`,
    }));
}

function getFormatButtons(dateNow) {
    const prefix = config.prefix || '.';
    return [
        { id: `${prefix}spfmt_audio_${dateNow}`,    text: '🎶 Audio' },
        { id: `${prefix}spfmt_audiodoc_${dateNow}`, text: '📄 Audio Document' },
    ];
}

// ── Module ────────────────────────────────────────────────────────────────────

module.exports = {
    name: 'spotify2',
    aliases: ['sp2', 'spdl2', 'spplay2'],
    category: 'media',
    description: 'Search and download Spotify songs',
    usage: '.spotify <song name>',

    async execute(sock, msg, args, extra) {
        if (!args.length) {
            return extra.reply(
                `🎵 *Spotify Downloader*\n\n` +
                `*Usage:*\n` +
                `• \`.spotify faded\` — search + download\n` +
                `• Reply to a message with \`.spotify\` — use replied text as query`
            );
        }

        let query = args.join(' ').trim();

        if (!query) {
            const quoted = extra?.quoted;
            query = quoted?.conversation || quoted?.extendedTextMessage?.text || '';
        }

        if (!query) {
            return extra.reply('🎵 Provide a song name.\nExample: `.spotify Faded`');
        }

        if (query.length > 100) {
            return extra.reply('📝 Song name too long! Max 100 chars.');
        }

        const from           = extra.from;
        const prefix         = config.prefix || '.';
        const originalSender = msg.key.participant || msg.key.remoteJid;

        await sock.sendMessage(from, { react: { text: '🔍', key: msg.key } });

        // ── Step 1: Search ────────────────────────────────────────────────────
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
            if (!selectedId.includes(`sptrack_`) || !selectedId.includes(`_${dateNow}`)) return;
            if (messageData.key?.remoteJid !== from) return;

            const responseSender = getResponseSender(messageData);
            if (from.endsWith('@g.us') && responseSender !== originalSender) return;

            // ✅ No sock.ev.off — allows picking different tracks repeatedly

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
                if (!fmtId.includes(`spfmt_`) || !fmtId.includes(`_${fmtDateNow}`)) return;
                if (fmtMsg.key?.remoteJid !== from) return;

                const fmtSender = getResponseSender(fmtMsg);
                if (from.endsWith('@g.us') && fmtSender !== originalSender) return;

                // ✅ No sock.ev.off — allows re-downloading in different formats

                await sock.sendMessage(from, { react: { text: '⏬', key: msg.key } });

                // ── Step 6: Download & send ───────────────────────────────────
                try {
                    const formatType = fmtId.replace(prefix, '').split('_')[1];

                    const exactQuery = `${track.artist} - ${track.title}`;
                    const apiData    = await downloadSpotify(exactQuery);

                    const tempDir  = path.join(__dirname, 'temp');
                    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
                    const filePath = path.join(tempDir, `sp_${fmtDateNow}.mp3`);

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
                            caption:  `> ${config.botName}`,
                        }, { quoted: fmtMsg });
                    }

                    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                    await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });

                } catch (error) {
                    console.error('[spotify] download error:', error.message);
                    await sock.sendMessage(from, { react: { text: '❌', key: msg.key } });
                    await sock.sendMessage(from, {
                        text: `🚫 Error: ${error.message}\n\n_Try again later._`,
                    }, { quoted: fmtMsg });
                }
            };

            sock.ev.on('messages.upsert', handleFormatSelect);
            // ✅ No setTimeout — no expiry on format buttons
        };

        sock.ev.on('messages.upsert', handleTrackSelect);
        // ✅ No setTimeout — no expiry on track buttons
    },
};
