/**
 * Spotify Command — powered by apiskeith.top
 *
 * Flow:
 *   1. Search via  /search/spotify?q=<query>  (up to 3 retries)
 *   2. Grab the first result's Spotify URL
 *   3. Download via  /download/spotify?url=<spotifyUrl>  (up to 3 retries)
 *   4. Send audio; if download fails, send the search card + links
 *
 * Usage:
 *   .spotify <song name>          — search + auto-download top result
 *   .spotify <spotify track url>  — download directly by URL
 */

const { keithApi } = require(require('path').join(global.__CORE__, 'utils', 'keithApi'));
const axios = require('axios');
const config = require(require('path').join(global.__ROOT__, 'config'));

const RETRY_DELAY = 3000; // ms between retries

async function withRetry(fn, retries = 3, delayMs = RETRY_DELAY) {
    let lastErr;
    for (let i = 0; i < retries; i++) {
        try {
            const result = await fn();
            return result;
        } catch (e) {
            lastErr = e;
            const isBusy = e.message?.toLowerCase().includes('busy') ||
                           e.message?.toLowerCase().includes('try again');
            if (i < retries - 1 && isBusy) {
                await new Promise(r => setTimeout(r, delayMs));
            } else if (!isBusy) {
                throw e; // non-transient error, don't retry
            }
        }
    }
    throw lastErr;
}

async function searchSpotify(query) {
    return withRetry(() => keithApi('/search/spotify', { q: query }));
}

async function downloadSpotify(spotifyUrl) {
    return withRetry(() => keithApi('/download/spotify', { url: spotifyUrl }));
}

function extractResults(data) {
    const raw = data?.result ?? data?.results ?? data?.data ?? data;
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return [raw];
    return [];
}

function pickSpotifyUrl(track) {
    return track?.url || track?.link || track?.spotify_url ||
           track?.spotifyUrl || track?.href || null;
}

function pickAudioUrl(data) {
    const r = data?.result ?? data?.data ?? data;
    if (typeof r === 'string' && r.startsWith('http')) return r;
    return r?.audio || r?.audioUrl || r?.download_url || r?.downloadUrl ||
           r?.media_url || r?.link || r?.url || null;
}

function pickThumbnail(data) {
    const r = data?.result ?? data?.data ?? data;
    return r?.thumbnail || r?.image || r?.cover || r?.albumArt || null;
}

function formatDuration(secs) {
    if (!secs || isNaN(secs)) return null;
    const m = Math.floor(secs / 60), s = secs % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

module.exports = {
    name: 'spotify',
    aliases: ['sp', 'spotifydl', 'spdown'],
    category: 'media',
    description: 'Search and download Spotify tracks',
    usage: '.spotify <song name or spotify URL>',

    async execute(sock, msg, args, extra) {
        if (!args.length) {
            return extra.reply(
                `🎵 *Spotify Downloader*\n\n` +
                `*Usage:*\n` +
                `• \`.spotify faded alan walker\` — search + download\n` +
                `• \`.spotify https://open.spotify.com/track/...\` — download directly`
            );
        }

        const query = args.join(' ').trim();
        const isDirectUrl = query.startsWith('https://open.spotify.com/');
        const from = extra.from;

        await sock.sendMessage(from, { react: { text: '🎵', key: msg.key } });

        let spotifyUrl = null;
        let trackInfo  = null;

        // ── Step 1: Resolve Spotify URL ───────────────────────────────────────
        if (isDirectUrl) {
            spotifyUrl = query;
        } else {
            try {
                await extra.reply(`🔍 Searching Spotify for *${query}*...`);
                const searchData = await searchSpotify(query);
                const results    = extractResults(searchData);

                if (!results.length) {
                    return extra.reply(`❌ No results found for *${query}*.`);
                }

                trackInfo  = results[0];
                spotifyUrl = pickSpotifyUrl(trackInfo);

                // Build a results card (top 5) to show while downloading
                let card = `🎵 *Spotify — ${query}*\n━━━━━━━━━━━━━━━\n\n`;
                results.slice(0, 5).forEach((r, i) => {
                    const title    = r.title || r.name || '?';
                    const artist   = r.artist || r.artists || '';
                    const duration = r.duration || (r.duration_ms ? formatDuration(Math.round(r.duration_ms / 1000)) : null);
                    const link     = pickSpotifyUrl(r) || '';
                    card += `*${i + 1}.* 🎶 ${title}\n`;
                    if (artist)   card += `   🎤 ${artist}\n`;
                    if (duration) card += `   ⏱ ${duration}\n`;
                    if (link)     card += `   🔗 ${link}\n`;
                    card += '\n';
                });

                await sock.sendMessage(from, { text: card.trim() }, { quoted: msg });

                if (!spotifyUrl) {
                    return; // No downloadable URL found — search card is enough
                }

            } catch (e) {
                console.error('[spotify] search error:', e.message);
                return extra.reply(`❌ Search failed: ${e.message}`);
            }
        }

        // ── Step 2: Download the track ────────────────────────────────────────
        if (!spotifyUrl) {
            return extra.reply('❌ Could not get a Spotify URL to download.');
        }

        try {
            await extra.reply(`⬇️ Downloading track...`);
            const dlData  = await downloadSpotify(spotifyUrl);
            const audioUrl = pickAudioUrl(dlData);

            if (!audioUrl) {
                throw new Error(dlData?.error || dlData?.message || 'No audio URL in response');
            }

            // Fetch audio buffer
            const audioResp = await axios.get(audioUrl, {
                responseType: 'arraybuffer',
                timeout: 60000,
                headers: { 'User-Agent': 'Mozilla/5.0' },
            });
            const audioBuffer = Buffer.from(audioResp.data);

            // Gather metadata for the audio caption
            const r = dlData?.result ?? dlData?.data ?? dlData;
            const title    = r?.title || trackInfo?.title || trackInfo?.name || query;
            const artist   = r?.artist || r?.artists || trackInfo?.artist || trackInfo?.artists || '';
            const duration = r?.duration || trackInfo?.duration || '';
            const thumbUrl = pickThumbnail(dlData) || pickThumbnail({ result: trackInfo }) || '';

            const caption =
                `🎵 *${title}*\n` +
                (artist   ? `🎤 ${artist}\n`   : '') +
                (duration ? `⏱ ${duration}\n` : '') +
                `\n> Downloaded via ${config.botName}`;

            // Send thumbnail if available
            if (thumbUrl) {
                try {
                    const thumbResp = await axios.get(thumbUrl, {
                        responseType: 'arraybuffer', timeout: 15000,
                    });
                    await sock.sendMessage(from, {
                        image: Buffer.from(thumbResp.data),
                        caption: `🖼️ *${title}*`,
                    }, { quoted: msg });
                } catch (_) {}
            }

            // Send audio
            await sock.sendMessage(from, {
                audio: audioBuffer,
                mimetype: 'audio/mpeg',
                fileName: `${title}.mp3`,
            }, { quoted: msg });

            await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });

        } catch (e) {
            console.error('[spotify] download error:', e.message);
            await sock.sendMessage(from, { react: { text: '❌', key: msg.key } });
            await extra.reply(
                `❌ Download failed: ${e.message}\n\n` +
                `_Try again later or use the Spotify link directly._`
            );
        }
    },
};
