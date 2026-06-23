/**
 * Movie / Series Commands
 * Metadata  : OMDb API  (omdbapi.com)
 * Downloads : YTS API   (yts.mx)
 */

// ── Config ────────────────────────────────────────────────────────────────────

const OMDB_KEY = '5e186f64';
const OMDB     = 'http://www.omdbapi.com';
const YTS      = 'https://yts.mx/api/v2';

const TRACKERS = [
    'udp://tracker.opentrackr.org:1337/announce',
    'udp://open.tracker.cl:1337/announce',
    'udp://tracker.torrent.eu.org:451/announce',
    'udp://open.stealth.si:80/announce',
].map(t => `&tr=${encodeURIComponent(t)}`).join('');

// ── Helpers ───────────────────────────────────────────────────────────────────

const fetchJSON = async (url) => (await fetch(url)).json();

const react = (sock, msg, emoji) =>
    sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } });

const send = (sock, msg, text) =>
    sock.sendMessage(msg.key.remoteJid, { text }, { quoted: msg });

const sendImage = (sock, msg, url, caption) =>
    sock.sendMessage(msg.key.remoteJid, { image: { url }, caption }, { quoted: msg });

const magnet = (hash, title) =>
    `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}${TRACKERS}`;

const isValidPoster = (url) =>
    url && url !== 'N/A' && url.startsWith('http');

// ── Auto ID resolver ──────────────────────────────────────────────────────────
// Accepts either a raw IMDB ID (tt...) or a title string
// Returns { id, title, type, year, poster } or null

async function resolveID(input) {
    // already an IMDB ID
    if (/^tt\d+$/i.test(input)) {
        const data = await fetchJSON(
            `${OMDB}/?i=${input}&apikey=${OMDB_KEY}`
        );
        if (data.Response === 'False') return null;
        return {
            id:     data.imdbID,
            title:  data.Title,
            type:   data.Type,
            year:   data.Year,
            poster: data.Poster,
        };
    }

    // title string — search and take top result
    const data = await fetchJSON(
        `${OMDB}/?s=${encodeURIComponent(input)}&apikey=${OMDB_KEY}`
    );
    if (data.Response === 'False' || !data.Search?.length) return null;

    const top = data.Search[0];
    return {
        id:     top.imdbID,
        title:  top.Title,
        type:   top.Type,
        year:   top.Year,
        poster: top.Poster,
    };
}

// ── Commands ──────────────────────────────────────────────────────────────────

module.exports = [

    {
        name: 'movie',
        aliases: ['searchmovie', 'findmovie', 'omdb'],
        category: 'media',
        description: 'Search for a movie or series by title',
        usage: '.movie <title>',

        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply(
                '❌ *Please provide a title*\n\n' +
                '*Usage:* .movie <title>\n' +
                '*Example:* .movie Avengers Endgame'
            );

            await react(sock, msg, '🎬');
            await extra.reply('⏳ *Searching...*');

            try {
                const data = await fetchJSON(
                    `${OMDB}/?s=${encodeURIComponent(query)}&apikey=${OMDB_KEY}`
                );

                if (data.Response === 'False') {
                    await react(sock, msg, '❌');
                    return extra.reply(
                        `❌ No results found for *"${query}"*\n\n` +
                        `_${data.Error || 'Try a different title'}_`
                    );
                }

                const results = data.Search.slice(0, 6);
                const total   = data.totalResults || results.length;

                let text =
                    `🎬 *Search Results*\n` +
                    `🔍 Query: *${query}*\n` +
                    `📊 Found: *${total}* results\n\n`;

                results.forEach((item, i) => {
                    const icon =
                        item.Type === 'series'  ? '📺' :
                        item.Type === 'episode' ? '🎞️' : '🎬';
                    text +=
                        `*${i + 1}. ${item.Title}* (${item.Year})\n` +
                        `   ${icon} ${item.Type?.toUpperCase()}\n` +
                        `   🆔 \`${item.imdbID}\`\n\n`;
                });

                text +=
                    `━━━━━━━━━━━━━━━━━━\n` +
                    `_All commands below accept a *title* or *IMDB ID*_\n\n` +
                    `*.minfo <title/id>*   — full details\n` +
                    `*.mdl <title/id>*     — movie download\n` +
                    `*.series <title/id>*  — series seasons\n` +
                    `*.trending*           — latest movies`;

                await send(sock, msg, text);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[movie]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Search failed. Please try again later.');
            }
        },
    },

    {
        name: 'minfo',
        aliases: ['movieinfo', 'filminfo'],
        category: 'media',
        description: 'Get full details by title or IMDB ID',
        usage: '.minfo <title or imdbID>',

        async execute(sock, msg, args, extra) {
            const input = args.join(' ').trim();
            if (!input) return extra.reply(
                '❌ *Please provide a title or IMDB ID*\n\n' +
                '*Usage:* .minfo <title or imdbID>\n' +
                '*Example:* .minfo Inception\n' +
                '*Example:* .minfo tt1375666'
            );

            await react(sock, msg, '🎬');

            try {
                const resolved = await resolveID(input);
                if (!resolved) {
                    await react(sock, msg, '❌');
                    return extra.reply(`❌ Nothing found for *"${input}"*`);
                }

                const m = await fetchJSON(
                    `${OMDB}/?i=${resolved.id}&plot=full&apikey=${OMDB_KEY}`
                );

                if (m.Response === 'False') {
                    await react(sock, msg, '❌');
                    return extra.reply(`❌ ${m.Error}`);
                }

                const icon = m.Type === 'series' ? '📺' : '🎬';

                let text =
                    `${icon} *${m.Title}* (${m.Year})\n\n` +
                    `📖 *Plot:*\n${m.Plot || 'No plot available.'}\n\n` +
                    `⭐ *IMDB Rating:* ${m.imdbRating}/10 (${m.imdbVotes} votes)\n` +
                    `🍅 *Rotten Tomatoes:* ${m.Ratings?.find(r => r.Source === 'Rotten Tomatoes')?.Value || 'N/A'}\n` +
                    `🎭 *Genre:* ${m.Genre || 'N/A'}\n` +
                    `⏱️ *Runtime:* ${m.Runtime || 'N/A'}\n` +
                    `🌍 *Language:* ${m.Language || 'N/A'}\n` +
                    `📅 *Released:* ${m.Released || 'N/A'}\n` +
                    `🎥 *Director:* ${m.Director || 'N/A'}\n` +
                    `✍️ *Writer:* ${m.Writer || 'N/A'}\n` +
                    `👥 *Cast:* ${m.Actors || 'N/A'}\n` +
                    `🏆 *Awards:* ${m.Awards || 'N/A'}\n` +
                    `🔞 *Rated:* ${m.Rated || 'N/A'}\n` +
                    `🆔 *IMDB ID:* \`${m.imdbID}\`\n\n`;

                if (m.Type === 'series') {
                    text +=
                        `📦 *Total Seasons:* ${m.totalSeasons || 'N/A'}\n\n` +
                        `━━━━━━━━━━━━━━━━━━\n` +
                        `_Use_ *.series ${m.Title}* _to browse seasons_`;
                } else {
                    text +=
                        `━━━━━━━━━━━━━━━━━━\n` +
                        `_Use_ *.mdl ${m.Title}* _to get download links_`;
                }

                if (isValidPoster(m.Poster)) {
                    await sendImage(sock, msg, m.Poster, text);
                } else {
                    await send(sock, msg, text);
                }

                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[minfo]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Failed to fetch details. Please try again later.');
            }
        },
    },

    {
        name: 'mdl',
        aliases: ['moviedl', 'mdownload'],
        category: 'media',
        description: 'Get movie download links by title or IMDB ID',
        usage: '.mdl <title or imdbID>',

        async execute(sock, msg, args, extra) {
            const input = args.join(' ').trim();
            if (!input) return extra.reply(
                '❌ *Please provide a title or IMDB ID*\n\n' +
                '*Usage:* .mdl <title or imdbID>\n' +
                '*Example:* .mdl Interstellar\n' +
                '*Example:* .mdl tt0816692'
            );

            await react(sock, msg, '📥');
            await extra.reply('⏳ *Fetching download links...*');

            try {
                // Step 1 — resolve ID
                const resolved = await resolveID(input);
                if (!resolved) {
                    await react(sock, msg, '❌');
                    return extra.reply(`❌ Nothing found for *"${input}"*`);
                }

                if (resolved.type === 'series') {
                    await react(sock, msg, '❌');
                    return extra.reply(
                        `❌ *${resolved.title}* is a series, not a movie.\n\n` +
                        `_Use_ *.series ${resolved.title}* _to browse episodes_`
                    );
                }

                // Step 2 — get full OMDb metadata
                const meta = await fetchJSON(
                    `${OMDB}/?i=${resolved.id}&apikey=${OMDB_KEY}`
                );

                // Step 3 — get YTS download links using IMDB ID
                const yts = await fetchJSON(
                    `${YTS}/list_movies.json?query_term=${resolved.id}&with_images=true`
                );

                const poster = isValidPoster(meta.Poster) ? meta.Poster : null;

                let text =
                    `📥 *${meta.Title}* (${meta.Year})\n` +
                    `⭐ ${meta.imdbRating}/10  🎭 ${meta.Genre || 'N/A'}\n` +
                    `⏱️ ${meta.Runtime || 'N/A'}  🌍 ${meta.Language || 'N/A'}\n` +
                    `🆔 IMDB: \`${meta.imdbID}\`\n\n` +
                    `━━━━━━━━━━━━━━━━━━\n` +
                    `📥 *Download Links:*\n\n`;

                if (yts.status === 'ok' && yts.data?.movies?.length) {
                    const movie = yts.data.movies[0];
                    movie.torrents?.forEach((t) => {
                        const mag = magnet(t.hash, movie.title_long);
                        text +=
                            `🔗 *${t.quality}* (${t.type?.toUpperCase() || 'WEB'}) — ${t.size}\n` +
                            `📄 Torrent: ${t.url}\n` +
                            `🧲 Magnet:\n${mag}\n\n`;
                    });
                } else {
                    text +=
                        `❌ *No YTS download links found.*\n\n` +
                        `• Movie may not be on YTS yet\n` +
                        `• Try searching manually:\n` +
                        `https://yts.mx/movies/${meta.Title.toLowerCase().replace(/ /g, '-')}-${meta.Year}\n\n`;
                }

                text += `━━━━━━━━━━━━━━━━━━\n_Metadata by OMDb · Downloads by YTS_`;

                if (poster) {
                    await sendImage(sock, msg, poster, text);
                } else {
                    await send(sock, msg, text);
                }

                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[mdl]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Failed to fetch download links. Please try again later.');
            }
        },
    },

    {
        name: 'series',
        aliases: ['tvshow', 'sinfo'],
        category: 'media',
        description: 'Browse series seasons and episodes by title or IMDB ID',
        usage: '.series <title or imdbID> [season]',

        async execute(sock, msg, args, extra) {
            if (!args.length) return extra.reply(
                '❌ *Please provide a title or IMDB ID*\n\n' +
                '*Usage:* .series <title or imdbID> [season]\n' +
                '*Example:* .series Breaking Bad\n' +
                '*Example:* .series Breaking Bad 2\n' +
                '*Example:* .series tt0903747 3'
            );

            await react(sock, msg, '📺');
            await extra.reply('⏳ *Fetching series info...*');

            try {
                // last arg is a season number if it's a pure digit
                const lastArg   = args[args.length - 1];
                const hasSeason = /^\d+$/.test(lastArg);
                const season    = hasSeason ? lastArg : null;
                const input     = hasSeason
                    ? args.slice(0, -1).join(' ').trim()
                    : args.join(' ').trim();

                // resolve ID from title or raw IMDB ID
                const resolved = await resolveID(input);
                if (!resolved) {
                    await react(sock, msg, '❌');
                    return extra.reply(`❌ Nothing found for *"${input}"*`);
                }

                if (resolved.type !== 'series') {
                    await react(sock, msg, '❌');
                    return extra.reply(
                        `❌ *${resolved.title}* is a *${resolved.type}*, not a series.\n\n` +
                        `_Use_ *.minfo ${resolved.title}* _for details_`
                    );
                }

                if (season) {
                    // ── Season episodes ───────────────────────────────────────
                    const data = await fetchJSON(
                        `${OMDB}/?i=${resolved.id}&Season=${season}&apikey=${OMDB_KEY}`
                    );

                    if (data.Response === 'False') {
                        await react(sock, msg, '❌');
                        return extra.reply(
                            `❌ Season *${season}* not found for *${resolved.title}*\n\n` +
                            `_${data.Error || 'Check the season number'}_`
                        );
                    }

                    let text =
                        `📺 *${data.Title}* — Season *${season}*\n` +
                        `🎬 *${data.Episodes?.length || 0}* Episodes\n\n`;

                    data.Episodes?.forEach((ep) => {
                        const rating = ep.imdbRating !== 'N/A' ? `⭐ ${ep.imdbRating}` : '';
                        text +=
                            `*E${String(ep.Episode).padStart(2, '0')}* — ${ep.Title} ${rating}\n` +
                            `   📅 ${ep.Released || 'N/A'}  🆔 \`${ep.imdbID}\`\n\n`;
                    });

                    text += `_Use_ *.epinfo <imdbID>* _on any episode for full details_`;

                    await send(sock, msg, text);
                } else {
                    // ── Series overview ───────────────────────────────────────
                    const s = await fetchJSON(
                        `${OMDB}/?i=${resolved.id}&plot=short&apikey=${OMDB_KEY}`
                    );

                    if (s.Response === 'False') {
                        await react(sock, msg, '❌');
                        return extra.reply(`❌ ${s.Error}`);
                    }

                    const totalSeasons = parseInt(s.totalSeasons) || 0;
                    const poster       = isValidPoster(s.Poster) ? s.Poster : null;

                    let text =
                        `📺 *${s.Title}* (${s.Year})\n\n` +
                        `📖 *Plot:*\n${s.Plot || 'No plot available.'}\n\n` +
                        `⭐ *IMDB Rating:* ${s.imdbRating}/10\n` +
                        `🎭 *Genre:* ${s.Genre || 'N/A'}\n` +
                        `📦 *Total Seasons:* ${s.totalSeasons || 'N/A'}\n` +
                        `📅 *First Air Date:* ${s.Released || 'N/A'}\n` +
                        `📡 *Status:* ${s.Year?.includes('–') ? 'Ongoing' : 'Ended'}\n` +
                        `👥 *Cast:* ${s.Actors || 'N/A'}\n` +
                        `🆔 *IMDB ID:* \`${s.imdbID}\`\n\n` +
                        `━━━━━━━━━━━━━━━━━━\n` +
                        `📋 *Seasons:*\n\n`;

                    for (let i = 1; i <= Math.min(totalSeasons, 20); i++) {
                        text += `📦 *Season ${i}* → *.series ${s.Title} ${i}*\n`;
                    }

                    text += `\n━━━━━━━━━━━━━━━━━━\n_Powered by OMDb API_`;

                    if (poster) {
                        await sendImage(sock, msg, poster, text);
                    } else {
                        await send(sock, msg, text);
                    }
                }

                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[series]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Failed to fetch series info. Please try again later.');
            }
        },
    },

    {
        name: 'epinfo',
        aliases: ['episodeinfo', 'einfo'],
        category: 'media',
        description: 'Get full episode details by IMDB episode ID',
        usage: '.epinfo <imdbID>',

        async execute(sock, msg, args, extra) {
            const id = args[0]?.trim();
            if (!id) return extra.reply(
                '❌ *Please provide an episode IMDB ID*\n\n' +
                '*Usage:* .epinfo <imdbID>\n' +
                '*Example:* .epinfo tt1232456\n\n' +
                '_Get episode IDs from_ *.series <title> <season>*'
            );

            await react(sock, msg, '🎞️');
            await extra.reply('⏳ *Fetching episode details...*');

            try {
                const ep = await fetchJSON(
                    `${OMDB}/?i=${id}&plot=full&apikey=${OMDB_KEY}`
                );

                if (ep.Response === 'False') {
                    await react(sock, msg, '❌');
                    return extra.reply(`❌ ${ep.Error}`);
                }

                const poster = isValidPoster(ep.Poster) ? ep.Poster : null;

                const text =
                    `🎞️ *${ep.Title}*\n\n` +
                    `📖 *Plot:*\n${ep.Plot || 'No plot available.'}\n\n` +
                    `⭐ *IMDB Rating:* ${ep.imdbRating}/10 (${ep.imdbVotes} votes)\n` +
                    `📅 *Released:* ${ep.Released || 'N/A'}\n` +
                    `⏱️ *Runtime:* ${ep.Runtime || 'N/A'}\n` +
                    `🎥 *Director:* ${ep.Director || 'N/A'}\n` +
                    `👥 *Cast:* ${ep.Actors || 'N/A'}\n` +
                    `🔞 *Rated:* ${ep.Rated || 'N/A'}\n\n` +
                    `━━━━━━━━━━━━━━━━━━\n` +
                    `_Powered by OMDb API_`;

                if (poster) {
                    await sendImage(sock, msg, poster, text);
                } else {
                    await send(sock, msg, text);
                }

                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[epinfo]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Failed to fetch episode. Please try again later.');
            }
        },
    },

    {
        name: 'trending',
        aliases: ['latestmovies', 'topmovies'],
        category: 'media',
        description: 'Get latest or top rated movies from YTS',
        usage: '.trending | .trending rating | .trending <genre>',

        async execute(sock, msg, args, extra) {
            const input   = args[0]?.toLowerCase();
            const genres  = ['action','comedy','drama','horror','sci-fi','thriller','romance','animation','crime','documentary'];
            const isGenre = genres.includes(input);
            const sortBy  = input === 'rating' ? 'rating' : 'date_added';
            const genre   = isGenre ? input : '';

            await react(sock, msg, '🔥');
            await extra.reply('⏳ *Fetching trending movies...*');

            try {
                let url = `${YTS}/list_movies.json?limit=8&sort_by=${sortBy}&with_images=true`;
                if (genre) url += `&genre=${genre}`;

                const data = await fetchJSON(url);

                if (data.status !== 'ok' || !data.data?.movies?.length) {
                    await react(sock, msg, '❌');
                    return extra.reply('❌ Failed to fetch trending movies.');
                }

                const label = genre
                    ? `🎬 Trending ${genre.charAt(0).toUpperCase() + genre.slice(1)}`
                    : input === 'rating'
                    ? '⭐ Top Rated Movies'
                    : '🔥 Latest Movies on YTS';

                let text = `${label}\n\n`;

                data.data.movies.forEach((m, i) => {
                    const qualities = m.torrents?.map(t => t.quality).join(' / ') || 'N/A';
                    text +=
                        `*${i + 1}. ${m.title}* (${m.year})\n` +
                        `   ⭐ ${m.rating}/10  📦 ${qualities}\n` +
                        `   🆔 \`${m.imdb_code}\`\n\n`;
                });

                text +=
                    `━━━━━━━━━━━━━━━━━━\n` +
                    `_Use_ *.minfo <title>* _for details_\n` +
                    `_Use_ *.mdl <title>* _for download links_`;

                await send(sock, msg, text);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[trending]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Failed. Please try again later.');
            }
        },
    },

];
