/**
 * Spotify Command — powered by api.nexray.eu.cc
 * Search: GET /search/spotify?q=<query>
 * Download: GET /downloader/spotifyplay?q=<artist - title>
 * No buttons — reply-based track selection
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../../config');

const RETRY_DELAY = 3000;
const MAX_RESULTS = 5;
const SELECTION_TIMEOUT = 60000; // 60 s to pick a track

// ── Helpers ───────────────────────────────────────────────────────────────────

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
 * Download by "Artist - Title" query
 * Always resolves to: { downloadUrl, title, artist, album, duration, thumbnail }
 */
async function downloadSpotify(exactQuery) {
    return withRetry(async () => {
        const res = await axios.get(
            `https://api.nexray.eu.cc/downloader/spotifyplay?q=${encodeURIComponent(exactQuery)}`,
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

// ── Module ────────────────────────────────────────────────────────────────────

module.exports = {
    name: 'spotify',
    aliases: ['sp', 'spdl', 'spplay'],
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
        if (!query) return extra.reply('🎵 Provide a song name.\nExample: `.spotify Faded`');
        if (query.length > 100) return extra.reply('📝 Song name too long! Max 100 chars.');

        const from           = extra.from;
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

        // ── Step 2: Display numbered results ──────────────────────────────────
        const resultText = tracks.map((t, i) =>
            `*${i + 1}.* ${t.title}\n` +
            `    👤 ${t.artist}  •  ⏱ ${t.duration}  •  💿 ${t.album}`
        ).join('\n\n');

        await extra.reply(
            `🎵 *Spotify Search Results*\n` +
            `*Query:* _${query}_\n\n` +
            `${resultText}\n\n` +
            `_Reply with a number (1–${tracks.length}) to download_`
        );

        await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });

        // ── Step 3: Listen for number reply ───────────────────────────────────
        const handleSelection = async (event) => {
            const messageData = event.messages[0];
            if (!messageData?.message) return;

            // Must come from same chat and same sender
            if (messageData.key?.remoteJid !== from) return;
            const responseSender = getResponseSender(messageData);
            if (from.endsWith('@g.us') && responseSender !== originalSender) return;

            // Extract plain text — ignore commands and non-numeric replies
            const text = (
                messageData.message?.conversation ||
                messageData.message?.extendedTextMessage?.text || ''
            ).trim();

            if (!/^[1-5]$/.test(text)) return; // only 1–5

            const choice = parseInt(text) - 1;
            const track  = tracks[choice];
            if (!track) return;

            sock.ev.off('messages.upsert', handleSelection);
            clearTimeout(selectionTimer);

            await sock.sendMessage(from, { react: { text: '⬇️', key: msg.key } });

            // ── Step 4: Download & send ───────────────────────────────────────
            try {
                const exactQuery = `${track.artist} - ${track.title}`;
                const apiData    = await downloadSpotify(exactQuery);

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

                const rawTitle   = apiData.title || track.title || '';
                const cleanTitle = rawTitle.replace(/[^\w\s.-]/gi, '').substring(0, 100);

                // Send as audio message
                await sock.sendMessage(from, {
                    audio:    { url: filePath },
                    mimetype: 'audio/mpeg',
                }, { quoted: messageData });

                // Send as document so it's downloadable
                await sock.sendMessage(from, {
                    document: { url: filePath },
                    mimetype: 'audio/mpeg',
                    fileName: `${cleanTitle}.mp3`,
                    caption:  `> ${config.botName}`,
                }, { quoted: messageData });

                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });

            } catch (error) {
                console.error('[spotify] download error:', error.message);
                await sock.sendMessage(from, { react: { text: '❌', key: msg.key } });
                await sock.sendMessage(from, {
                    text: `🚫 Error: ${error.message}\n\n_Try again later._`,
                }, { quoted: messageData });
            }
        };

        sock.ev.on('messages.upsert', handleSelection);

        // Auto-remove listener after timeout
        const selectionTimer = setTimeout(() => {
            sock.ev.off('messages.upsert', handleSelection);
            sock.sendMessage(from, {
                text: `⏳ Selection timed out. Run \`.spotify ${query}\` again.`,
            });
        }, SELECTION_TIMEOUT);
    },
};
