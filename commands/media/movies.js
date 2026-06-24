/**
 * Movie Commands — Powered by Keith API (ravenn.site)
 * Covers all 13 movie endpoints
 *
 * Commands:
 *  .iboxtv [page]           — Trending TV shows
 *  .tvdetail <url>          — TV show details + download link
 *  .tvsearch <query> [page] — Search TV shows
 *  .iboxmovies [page]       — Trending movies
 *  .moviedetail <url>       — Movie details + download link
 *  .moviesearch <query>     — Search movies (MovieBox)
 *  .iboxanime [page]        — Trending anime
 *  .animedetail <url>       — Anime details + download link
 *  .animesearch <query> [page] — Search anime
 *  .dramabox <bookId> [ep]  — DramaBox episode stream link
 *  .actor <name>            — Search actors (IMDb)
 *  .moviebox <query>        — MovieBox search with URLs
 *  .trailer <moviebox_url>  — Get trailer for a MovieBox title
 */

const axios = require('axios');

const BASE = 'https://ravenn.site';

async function keithApi(endpoint, params = {}) {
    const url = `${BASE}${endpoint}`;
    const { data } = await axios.get(url, { params, timeout: 30000 });
    if (!data) throw new Error('No response from API');
    if (data.status === false) throw new Error(data.error || data.message || 'API error');
    return data.result !== undefined ? data.result : data;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const react = (sock, msg, emoji) =>
    sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } });

const send = (sock, msg, text) =>
    sock.sendMessage(msg.key.remoteJid, { text }, { quoted: msg });

async function sendLong(sock, msg, header, body, footer = '┗━━━━━━━━━━━━━━━━') {
    const LIMIT = 3500;
    const lines = body.split('\n');
    const chunks = [];
    let cur = '';
    for (const line of lines) {
        if ((cur + line + '\n').length > LIMIT) { chunks.push(cur); cur = ''; }
        cur += line + '\n';
    }
    if (cur.trim()) chunks.push(cur);
    if (!chunks.length) chunks.push('_No data available_');

    for (let i = 0; i < chunks.length; i++) {
        const part = chunks.length > 1 ? ` (${i + 1}/${chunks.length})` : '';
        const isLast = i === chunks.length - 1;
        const text =
            (i === 0 ? `${header}${part}\n\n` : `${header}${part} cont...\n\n`) +
            chunks[i] +
            (isLast ? `\n${footer}` : '');
        await sock.sendMessage(msg.key.remoteJid, { text }, { quoted: i === 0 ? msg : undefined });
    }
}

// Fix doubled rating strings like "7.87.8" → "7.8"
function fixRating(r) {
    if (!r) return 'N/A';
    const s = String(r);
    const half = s.slice(0, Math.floor(s.length / 2));
    return (half === s.slice(Math.floor(s.length / 2))) ? half : s;
}

// ── Formatters ──────────────────────────────────────────────────────────────────

function fmtIboxListing(result, label) {
    const trending = (result.trending || []).slice(0, 5);
    const items    = (result.items    || []).slice(0, 8);
    const page     = result.page || 1;
    const total    = result.totalPages || '?';

    let body = '';

    if (trending.length) {
        body += `🔥 *Trending*\n`;
        body += trending.map((t, i) =>
            `${i + 1}. *${t.title}*\n   🔗 ${t.url}`
        ).join('\n') + '\n\n';
    }

    if (items.length) {
        body += `🆕 *Latest*\n`;
        body += items.map((t, i) => {
            let line = `${i + 1}. *${t.title}*`;
            if (t.episode) line += `\n   📺 ${t.episode.replace(/\s+/g, ' ').trim()}`;
            line += `\n   🔗 ${t.url}`;
            return line;
        }).join('\n');
    }

    body += `\n\n📄 Page ${page} of ${total}`;
    return body;
}

function fmtDetail(result) {
    let body = '';
    if (result.title)         body += `🎬 *${result.title}*\n`;
    if (result.episodeTitle)  body += `📺 ${result.episodeTitle}\n`;
    if (result.year)          body += `📅 Year: ${result.year}\n`;
    if (result.rating)        body += `⭐ Rating: ${result.rating}/10\n`;
    if (result.overview)      body += `\n📝 ${result.overview.slice(0, 400).trim()}\n`;
    if (result.downloadUrl)   body += `\n📥 *Download:* ${result.downloadUrl}\n`;
    if (result.telegramChannel) body += `📢 Telegram: ${result.telegramChannel}\n`;
    if (result.url)           body += `🔗 Source: ${result.url}\n`;
    return body || '_No details found_';
}

function fmtSearch(items, label) {
    const arr = Array.isArray(items) ? items : [];
    if (!arr.length) return `_No ${label} found_`;
    return arr.slice(0, 10).map((t, i) => {
        let line = `${i + 1}. *${t.title || t.name || 'Untitled'}*`;
        if (t.episode) line += ` — ${t.episode.replace(/\s+/g, ' ').trim()}`;
        if (t.url)     line += `\n   🔗 ${t.url}`;
        return line;
    }).join('\n');
}

function fmtMovieBoxSearch(result) {
    const arr = Array.isArray(result.results) ? result.results : [];
    if (!arr.length) return '_No results found_';
    return arr.slice(0, 10).map((t, i) => {
        let line = `${i + 1}. *${t.title}*`;
        if (t.type)   line += ` [${t.type}]`;
        if (t.rating) line += ` ⭐ ${fixRating(t.rating)}`;
        if (t.url)    line += `\n   🔗 ${t.url}`;
        return line;
    }).join('\n');
}

function fmtActor(arr) {
    if (!arr.length) return '_No actors found_';
    return arr.slice(0, 5).map((a, i) => {
        let line = `${i + 1}. *${a.name}*`;
        if (a.knownFor) line += `\n   🎭 ${a.knownFor}`;
        if (a.detailUrl) line += `\n   🔗 ${a.detailUrl}`;
        return line;
    }).join('\n\n');
}

function fmtTrailer(result) {
    let body = '';
    if (result.title)       body += `🎬 *${result.title}*\n`;
    if (result.description) body += `\n📝 ${result.description.slice(0, 300).trim()}\n`;
    if (result.thumbnail)   body += `\n🖼️ Thumbnail: ${result.thumbnail}\n`;
    if (result.trailerUrl)  body += `\n▶️ *Trailer:* ${result.trailerUrl}\n`;
    if (result.url)         body += `🔗 Source: ${result.url}\n`;
    return body || '_No trailer info found_';
}

// ── Command definitions ────────────────────────────────────────────────────────

module.exports = [

    // ── iboxtv: trending TV shows ──────────────────────────────────────────────
    {
        name:        'iboxtv',
        aliases:     ['tvtrending', 'tvshows'],
        description: 'Trending TV shows from iBox',
        category:    'media',
        usage:       '.iboxtv [page]',
        execute: async (sock, msg, args) => {
            await react(sock, msg, '📺');
            const page = parseInt(args[0]) || 1;
            try {
                const result = await keithApi('/iboxtv', { page });
                const body   = fmtIboxListing(result, 'TV Shows');
                await sendLong(sock, msg,
                    `┏━━━ 📺 *iBox TV Trending* ━━━`,
                    body
                );
            } catch (e) {
                await react(sock, msg, '❌');
                await send(sock, msg, `❌ ${e.message}`);
            }
        },
    },

    // ── tvdetail: iboxtv show detail ───────────────────────────────────────────
    {
        name:        'tvdetail',
        aliases:     ['iboxtvdetail', 'showdetail'],
        description: 'Get details and download link for a TV show',
        category:    'media',
        usage:       '.tvdetail <iboxtv_url>',
        execute: async (sock, msg, args) => {
            if (!args[0]) return send(sock, msg, '❌ Usage: .tvdetail <iboxtv_url>');
            await react(sock, msg, '🔍');
            const url = args.join(' ').trim();
            try {
                const result = await keithApi('/iboxtv/detail', { url });
                const body   = fmtDetail(result);

                // Send thumbnail if available
                if (result.image) {
                    await sock.sendMessage(msg.key.remoteJid, {
                        image: { url: result.image },
                        caption: `┏━━━ 📺 *TV Show Detail* ━━━\n\n${body}\n┗━━━━━━━━━━━━━━━━`,
                    }, { quoted: msg });
                } else {
                    await sendLong(sock, msg, `┏━━━ 📺 *TV Show Detail* ━━━`, body);
                }
            } catch (e) {
                await react(sock, msg, '❌');
                await send(sock, msg, `❌ ${e.message}`);
            }
        },
    },

    // ── tvsearch: search iboxtv ────────────────────────────────────────────────
    {
        name:        'tvsearch',
        aliases:     ['iboxsearch', 'searchtv'],
        description: 'Search TV shows on iBox',
        category:    'media',
        usage:       '.tvsearch <query> [page]',
        execute: async (sock, msg, args) => {
            if (!args[0]) return send(sock, msg, '❌ Usage: .tvsearch <query>');
            await react(sock, msg, '🔍');
            const lastArg = args[args.length - 1];
            const hasPage = !isNaN(lastArg) && args.length > 1;
            const page    = hasPage ? parseInt(lastArg) : 1;
            const q       = hasPage ? args.slice(0, -1).join(' ') : args.join(' ');
            try {
                const result = await keithApi('/iboxtv/search', { q, page });
                const items  = result.results || result.items || result || [];
                const body   = fmtSearch(Array.isArray(items) ? items : [], 'TV shows');
                await sendLong(sock, msg,
                    `┏━━━ 🔍 *TV Search: "${q}"* ━━━`,
                    body
                );
            } catch (e) {
                await react(sock, msg, '❌');
                await send(sock, msg, `❌ ${e.message}`);
            }
        },
    },

    // ── iboxmovies: trending movies ────────────────────────────────────────────
    {
        name:        'iboxmovies',
        aliases:     ['movietrending', 'latestmovies'],
        description: 'Trending movies from iBox',
        category:    'media',
        usage:       '.iboxmovies [page]',
        execute: async (sock, msg, args) => {
            await react(sock, msg, '🎬');
            const page = parseInt(args[0]) || 1;
            try {
                const result = await keithApi('/iboxmovies', { page });
                const body   = fmtIboxListing(result, 'Movies');
                await sendLong(sock, msg,
                    `┏━━━ 🎬 *iBox Movies Trending* ━━━`,
                    body
                );
            } catch (e) {
                await react(sock, msg, '❌');
                await send(sock, msg, `❌ ${e.message}`);
            }
        },
    },

    // ── moviedetail: iboxmovies detail ────────────────────────────────────────
    {
        name:        'moviedetail',
        aliases:     ['iboxmoviedetail'],
        description: 'Get details and download link for a movie',
        category:    'media',
        usage:       '.moviedetail <iboxmovies_url>',
        execute: async (sock, msg, args) => {
            if (!args[0]) return send(sock, msg, '❌ Usage: .moviedetail <iboxmovies_url>');
            await react(sock, msg, '🔍');
            const url = args.join(' ').trim();
            try {
                const result = await keithApi('/iboxmovies/detail', { url });
                const body   = fmtDetail(result);

                if (result.image) {
                    await sock.sendMessage(msg.key.remoteJid, {
                        image: { url: result.image },
                        caption: `┏━━━ 🎬 *Movie Detail* ━━━\n\n${body}\n┗━━━━━━━━━━━━━━━━`,
                    }, { quoted: msg });
                } else {
                    await sendLong(sock, msg, `┏━━━ 🎬 *Movie Detail* ━━━`, body);
                }
            } catch (e) {
                await react(sock, msg, '❌');
                await send(sock, msg, `❌ ${e.message}`);
            }
        },
    },

    // ── moviesearch: search iboxmovies ────────────────────────────────────────
    {
        name:        'moviesearch',
        aliases:     ['iboxmoviesearch', 'searchmovie'],
        description: 'Search movies on iBox',
        category:    'media',
        usage:       '.moviesearch <query> [page]',
        execute: async (sock, msg, args) => {
            if (!args[0]) return send(sock, msg, '❌ Usage: .moviesearch <query>');
            await react(sock, msg, '🔍');
            const lastArg = args[args.length - 1];
            const hasPage = !isNaN(lastArg) && args.length > 1;
            const page    = hasPage ? parseInt(lastArg) : 1;
            const q       = hasPage ? args.slice(0, -1).join(' ') : args.join(' ');
            try {
                const result = await keithApi('/iboxmovies/search', { q, page });
                const items  = result.results || result.items || result || [];
                const body   = fmtSearch(Array.isArray(items) ? items : [], 'movies');
                await sendLong(sock, msg,
                    `┏━━━ 🔍 *Movie Search: "${q}"* ━━━`,
                    body
                );
            } catch (e) {
                await react(sock, msg, '❌');
                await send(sock, msg, `❌ ${e.message}`);
            }
        },
    },

    // ── iboxanime: trending anime ──────────────────────────────────────────────
    {
        name:        'iboxanime',
        aliases:     ['animetrending', 'latestanime'],
        description: 'Trending anime from iBox',
        category:    'media',
        usage:       '.iboxanime [page]',
        execute: async (sock, msg, args) => {
            await react(sock, msg, '🎌');
            const page = parseInt(args[0]) || 1;
            try {
                const result = await keithApi('/iboxanime', { page });
                const body   = fmtIboxListing(result, 'Anime');
                await sendLong(sock, msg,
                    `┏━━━ 🎌 *iBox Anime Trending* ━━━`,
                    body
                );
            } catch (e) {
                await react(sock, msg, '❌');
                await send(sock, msg, `❌ ${e.message}`);
            }
        },
    },

    // ── animedetail: iboxanime detail ──────────────────────────────────────────
    {
        name:        'animedetail',
        aliases:     ['iboxanimedetail'],
        description: 'Get details and download link for an anime',
        category:    'media',
        usage:       '.animedetail <iboxanime_url>',
        execute: async (sock, msg, args) => {
            if (!args[0]) return send(sock, msg, '❌ Usage: .animedetail <iboxanime_url>');
            await react(sock, msg, '🔍');
            const url = args.join(' ').trim();
            try {
                const result = await keithApi('/iboxanime/detail', { url });
                const body   = fmtDetail(result);

                if (result.image) {
                    await sock.sendMessage(msg.key.remoteJid, {
                        image: { url: result.image },
                        caption: `┏━━━ 🎌 *Anime Detail* ━━━\n\n${body}\n┗━━━━━━━━━━━━━━━━`,
                    }, { quoted: msg });
                } else {
                    await sendLong(sock, msg, `┏━━━ 🎌 *Anime Detail* ━━━`, body);
                }
            } catch (e) {
                await react(sock, msg, '❌');
                await send(sock, msg, `❌ ${e.message}`);
            }
        },
    },

    // ── animesearch: search iboxanime ──────────────────────────────────────────
    {
        name:        'animesearch',
        aliases:     ['iboxanimesearch', 'searchanime'],
        description: 'Search anime on iBox',
        category:    'media',
        usage:       '.animesearch <query> [page]',
        execute: async (sock, msg, args) => {
            if (!args[0]) return send(sock, msg, '❌ Usage: .animesearch <query>');
            await react(sock, msg, '🔍');
            const lastArg = args[args.length - 1];
            const hasPage = !isNaN(lastArg) && args.length > 1;
            const page    = hasPage ? parseInt(lastArg) : 1;
            const q       = hasPage ? args.slice(0, -1).join(' ') : args.join(' ');
            try {
                const result = await keithApi('/iboxanime/search', { q, page });
                const items  = result.results || result.items || result || [];
                const body   = fmtSearch(Array.isArray(items) ? items : [], 'anime');
                await sendLong(sock, msg,
                    `┏━━━ 🔍 *Anime Search: "${q}"* ━━━`,
                    body
                );
            } catch (e) {
                await react(sock, msg, '❌');
                await send(sock, msg, `❌ ${e.message}`);
            }
        },
    },

    // ── dramabox: DramaBox episode stream link ─────────────────────────────────
    {
        name:        'dramabox',
        aliases:     ['drama', 'dramastream'],
        description: 'Get DramaBox episode stream/download link',
        category:    'media',
        usage:       '.dramabox <bookId> [episode]',
        execute: async (sock, msg, args) => {
            if (!args[0]) return send(sock, msg,
                '❌ Usage: .dramabox <bookId> [episode]\n\nExample: .dramabox 41000105764 1'
            );
            await react(sock, msg, '🎭');
            const bookId  = args[0];
            const episode = parseInt(args[1]) || 1;
            try {
                const result = await keithApi('/dramabox/stream', { bookId, episode });
                let body = `🎭 *DramaBox Stream*\n\n`;
                body += `📚 Book ID: \`${bookId}\`\n`;
                body += `📺 Episode: ${episode}\n`;

                if (typeof result === 'string') {
                    body += `\n▶️ *Stream Link:*\n${result}`;
                } else if (result.url || result.streamUrl || result.link) {
                    const link = result.url || result.streamUrl || result.link;
                    body += `\n▶️ *Stream Link:*\n${link}`;
                    if (result.title)   body += `\n\n🎬 ${result.title}`;
                    if (result.quality) body += `\n📹 Quality: ${result.quality}`;
                } else {
                    body += `\n📦 Response:\n${JSON.stringify(result, null, 2).slice(0, 800)}`;
                }

                await send(sock, msg, `┏━━━ 🎭 *DramaBox* ━━━\n\n${body}\n\n┗━━━━━━━━━━━━━━━━`);
            } catch (e) {
                await react(sock, msg, '❌');
                await send(sock, msg, `❌ ${e.message}`);
            }
        },
    },

    // ── actor: search actors on IMDb ───────────────────────────────────────────
    {
        name:        'actor',
        aliases:     ['actorsearch', 'findactor'],
        description: 'Search actors on IMDb',
        category:    'media',
        usage:       '.actor <name>',
        execute: async (sock, msg, args) => {
            if (!args[0]) return send(sock, msg, '❌ Usage: .actor <name>');
            await react(sock, msg, '🎭');
            const q = args.join(' ');
            try {
                const result = await keithApi('/actor/search', { q });
                const arr    = Array.isArray(result) ? result : [];
                const body   = fmtActor(arr);

                // Send with first actor's image if available
                const first  = arr.find(a => a.image);
                if (first?.image) {
                    await sock.sendMessage(msg.key.remoteJid, {
                        image: { url: first.image },
                        caption: `┏━━━ 🎭 *Actor Search: "${q}"* ━━━\n\n${body}\n\n┗━━━━━━━━━━━━━━━━`,
                    }, { quoted: msg });
                } else {
                    await sendLong(sock, msg,
                        `┏━━━ 🎭 *Actor Search: "${q}"* ━━━`,
                        body
                    );
                }
            } catch (e) {
                await react(sock, msg, '❌');
                await send(sock, msg, `❌ ${e.message}`);
            }
        },
    },

    // ── moviebox: MovieBox search ──────────────────────────────────────────────
    {
        name:        'moviebox',
        aliases:     ['mbsearch', 'mbmovie'],
        description: 'Search movies on MovieBox (returns URLs usable with .trailer)',
        category:    'media',
        usage:       '.moviebox <query>',
        execute: async (sock, msg, args) => {
            if (!args[0]) return send(sock, msg, '❌ Usage: .moviebox <query>');
            await react(sock, msg, '🎬');
            const q = args.join(' ');
            try {
                const result = await keithApi('/moviebox/search', { q });
                const body   = fmtMovieBoxSearch(result);
                await sendLong(sock, msg,
                    `┏━━━ 🎬 *MovieBox: "${q}"* ━━━`,
                    body,
                    `\n💡 Use .trailer <url> to get trailer\n┗━━━━━━━━━━━━━━━━`
                );
            } catch (e) {
                await react(sock, msg, '❌');
                await send(sock, msg, `❌ ${e.message}`);
            }
        },
    },

    // ── trailer: get movie trailer via MovieBox URL ────────────────────────────
    {
        name:        'trailer',
        aliases:     ['movietrailer', 'gettrailer'],
        description: 'Get movie trailer from a MovieBox URL',
        category:    'media',
        usage:       '.trailer <moviebox_url>',
        execute: async (sock, msg, args) => {
            if (!args[0]) return send(sock, msg,
                '❌ Usage: .trailer <moviebox_url>\n\nGet URL from .moviebox <query>'
            );
            await react(sock, msg, '▶️');
            const q = args.join(' ').trim();
            try {
                const result = await keithApi('/movie/trailer', { q });
                const body   = fmtTrailer(result);

                if (result.thumbnail) {
                    await sock.sendMessage(msg.key.remoteJid, {
                        image: { url: result.thumbnail },
                        caption: `┏━━━ ▶️ *Movie Trailer* ━━━\n\n${body}\n┗━━━━━━━━━━━━━━━━`,
                    }, { quoted: msg });
                } else {
                    await sendLong(sock, msg, `┏━━━ ▶️ *Movie Trailer* ━━━`, body);
                }
            } catch (e) {
                await react(sock, msg, '❌');
                await send(sock, msg, `❌ ${e.message}`);
            }
        },
    },

];
