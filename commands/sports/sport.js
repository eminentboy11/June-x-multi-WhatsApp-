/**
 * Sport Commands — Powered by Keith API (ravenn.site/sports)
 * Covers all 41 endpoints
 */

const axios = require('axios');

const BASE = 'https://ravenn.site';

async function keithApi(endpoint, params = {}) {
    const url = `${BASE}${endpoint}`;
    const { data } = await axios.get(url, { params, timeout: 30000 });
    if (data && data.status === false) throw new Error(data.message || 'API returned error');
    return data;
}

const {
    formatStandings,
    formatScorers,
    formatMatches,
    formatLivescore,
    formatNews,
    formatObj,
} = require('../../utils/sportsFormatter');

const react = (sock, msg, emoji) =>
    sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } });

const send = (sock, msg, text) =>
    sock.sendMessage(msg.key.remoteJid, { text }, { quoted: msg });

function chunk(text, limit = 3500) {
    const lines = text.split('\n');
    const chunks = [];
    let cur = '';
    for (const line of lines) {
        if ((cur + line + '\n').length > limit) { chunks.push(cur); cur = ''; }
        cur += line + '\n';
    }
    if (cur.trim()) chunks.push(cur);
    return chunks;
}

async function sendLong(sock, msg, header, body, footer = '') {
    const parts = chunk(body);
    for (let i = 0; i < parts.length; i++) {
        const part = parts.length > 1 ? ` (${i + 1}/${parts.length})` : '';
        const text = (i === 0 ? `${header}${part}\n\n` : `${header}${part} cont...\n\n`) +
            parts[i] + (i === parts.length - 1 && footer ? `\n${footer}` : '');
        await sock.sendMessage(msg.key.remoteJid, { text }, { quoted: i === 0 ? msg : undefined });
    }
}

async function leagueHandler(sock, msg, extra, label, endpoints) {
    const sub = extra.args?.[0]?.toLowerCase() || '';
    const validSubs = Object.keys(endpoints);
    if (!sub || !validSubs.includes(sub)) {
        return send(sock, msg,
            `┏━━『 ${label} 』━━\n\n` +
            `Usage: .${extra.command} <option>\n\n` +
            `Options:\n` +
            validSubs.map(s => `  • ${s}`).join('\n') +
            `\n\n┗━━━━━━━━━━━━━━━━`
        );
    }
    await react(sock, msg, '⏳');
    try {
        const { endpoint, format, title } = endpoints[sub];
        const data = await keithApi(endpoint);
        const body = format(data);
        await sendLong(sock, msg, `┏━━『 ${label} — ${title} 』━━`, body, `┗━━━━━━━━━━━━━━━━`);
        await react(sock, msg, '✅');
    } catch (err) {
        console.error(`[${label}/${sub}]`, err.message);
        await react(sock, msg, '❌');
        extra.reply(`❌ Failed to fetch ${label} ${sub}: ${err.message}`);
    }
}

module.exports = [

    // ── 1. Player Search ───────────────────────────────────────────────────────
    {
        name: 'playersearch',
        aliases: ['psearch', 'findplayer2'],
        category: 'sports',
        description: 'Search for any sport player',
        usage: '.playersearch <player name>',

        async execute(sock, msg, args, extra) {
            const q = args.join(' ').trim();
            if (!q) return extra.reply('❌ Provide a player name.\n\nExample: *.playersearch Bukayo Saka*');
            await react(sock, msg, '🔍');
            try {
                const data = await keithApi('/sport/playersearch', { q });
                const body = formatObj(data);
                await sendLong(sock, msg, `┏━━『 🔍 Player Search: "${q}" 』━━`, body, `┗━━━━━━━━━━━━━━━━`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[playersearch]', err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ Search failed: ${err.message}`);
            }
        },
    },

    // ── 2. Team Search ─────────────────────────────────────────────────────────
    {
        name: 'kteamsearch',
        aliases: ['tsearch', 'findteamk'],
        category: 'sports',
        description: 'Search for any sport team',
        usage: '.kteamsearch <team name>',

        async execute(sock, msg, args, extra) {
            const q = args.join(' ').trim();
            if (!q) return extra.reply('❌ Provide a team name.\n\nExample: *.kteamsearch Arsenal*');
            await react(sock, msg, '🔍');
            try {
                const data = await keithApi('/sport/teamsearch', { q });
                const body = formatObj(data);
                await sendLong(sock, msg, `┏━━『 🔍 Team Search: "${q}" 』━━`, body, `┗━━━━━━━━━━━━━━━━`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[kteamsearch]', err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ Search failed: ${err.message}`);
            }
        },
    },

    // ── 3. Venue Search ────────────────────────────────────────────────────────
    {
        name: 'venuesearch',
        aliases: ['stadium', 'findstadium'],
        category: 'sports',
        description: 'Search for a stadium/venue',
        usage: '.venuesearch <venue name>',

        async execute(sock, msg, args, extra) {
            const q = args.join(' ').trim();
            if (!q) return extra.reply('❌ Provide a venue name.\n\nExample: *.venuesearch Emirates*');
            await react(sock, msg, '🔍');
            try {
                const data = await keithApi('/sport/venuesearch', { q });
                const body = formatObj(data);
                await sendLong(sock, msg, `┏━━『 🏟️ Venue Search: "${q}" 』━━`, body, `┗━━━━━━━━━━━━━━━━`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[venuesearch]', err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ Search failed: ${err.message}`);
            }
        },
    },

    // ── 4. Game Events History ─────────────────────────────────────────────────
    {
        name: 'gameevents',
        aliases: ['matchhistory', 'h2h'],
        category: 'sports',
        description: 'Search for game events/history (e.g. Arsenal vs Chelsea)',
        usage: '.gameevents <team1> vs <team2>',

        async execute(sock, msg, args, extra) {
            const q = args.join(' ').trim();
            if (!q) return extra.reply('❌ Provide a match query.\n\nExample: *.gameevents Arsenal vs Chelsea*');
            await react(sock, msg, '⏳');
            try {
                const data = await keithApi('/sport/gameevents', { q });
                const body = formatMatches(data);
                await sendLong(sock, msg, `┏━━『 📋 Game Events: "${q}" 』━━`, body, `┗━━━━━━━━━━━━━━━━`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[gameevents]', err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ Failed: ${err.message}`);
            }
        },
    },

    // ── 5. FIFA 2026 Standings ─────────────────────────────────────────────────
    {
        name: 'fifastandings',
        aliases: ['fifa2026', 'worldcup2026'],
        category: 'sports',
        description: 'Get FIFA 2026 details and current fixtures',
        usage: '.fifastandings',

        async execute(sock, msg, args, extra) {
            await react(sock, msg, '⏳');
            try {
                const data = await keithApi('/fifastandings');
                const body = formatStandings(data);
                await sendLong(sock, msg, `┏━━『 🏆 FIFA 2026 Standings 』━━`, body, `┗━━━━━━━━━━━━━━━━`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[fifastandings]', err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ Failed: ${err.message}`);
            }
        },
    },

    // ── 6. LiveScore ───────────────────────────────────────────────────────────
    {
        name: 'livescore',
        aliases: ['live', 'liveresults'],
        category: 'sports',
        description: 'Get current football live scores',
        usage: '.livescore',

        async execute(sock, msg, args, extra) {
            await react(sock, msg, '⏳');
            try {
                const data = await keithApi('/livescore');
                const body = formatLivescore(data);
                await sendLong(sock, msg, `┏━━『 🔴 LIVE SCORES 』━━`, body, `┗━━━━━━━━━━━━━━━━`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[livescore]', err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ Failed: ${err.message}`);
            }
        },
    },

    // ── 7. LiveScore with Highlights ───────────────────────────────────────────
    {
        name: 'livehighlights',
        aliases: ['livescore2', 'livehl'],
        category: 'sports',
        description: 'Get current football live scores with highlights',
        usage: '.livehighlights',

        async execute(sock, msg, args, extra) {
            await react(sock, msg, '⏳');
            try {
                const data = await keithApi('/livescore2');
                const body = formatLivescore(data);
                await sendLong(sock, msg, `┏━━『 🔴 LIVE SCORES + HIGHLIGHTS 』━━`, body, `┗━━━━━━━━━━━━━━━━`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[livehighlights]', err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ Failed: ${err.message}`);
            }
        },
    },

    // ── 8–11. EPL ──────────────────────────────────────────────────────────────
    {
        name: 'epl',
        aliases: ['premierleague', 'pl'],
        category: 'sports',
        description: 'EPL data — upcoming, matches, standings, scorers',
        usage: '.epl <upcoming|matches|standings|scorers>',

        async execute(sock, msg, args, extra) {
            extra.args = args;
            extra.command = 'epl';
            await leagueHandler(sock, msg, extra, '⚽ Premier League', {
                upcoming:  { endpoint: '/epl/upcomingmatches', format: formatMatches,   title: 'Upcoming Matches' },
                matches:   { endpoint: '/epl/matches',         format: formatMatches,   title: 'Matches'          },
                standings: { endpoint: '/epl/standings',       format: formatStandings, title: 'Standings'        },
                scorers:   { endpoint: '/epl/scorers',         format: formatScorers,   title: 'Top Scorers'      },
            });
        },
    },

    // ── 12–15. Bundesliga ──────────────────────────────────────────────────────
    {
        name: 'bundesliga',
        aliases: ['bund', 'germansoccer'],
        category: 'sports',
        description: 'Bundesliga data — upcoming, matches, standings, scorers',
        usage: '.bundesliga <upcoming|matches|standings|scorers>',

        async execute(sock, msg, args, extra) {
            extra.args = args;
            extra.command = 'bundesliga';
            await leagueHandler(sock, msg, extra, '🇩🇪 Bundesliga', {
                upcoming:  { endpoint: '/bundesliga/upcomingmatches', format: formatMatches,   title: 'Upcoming Matches' },
                matches:   { endpoint: '/bundesliga/matches',         format: formatMatches,   title: 'Matches'          },
                standings: { endpoint: '/bundesliga/standings',       format: formatStandings, title: 'Standings'        },
                scorers:   { endpoint: '/bundesliga/scorers',         format: formatScorers,   title: 'Top Scorers'      },
            });
        },
    },

    // ── 16–19. Euros ───────────────────────────────────────────────────────────
    {
        name: 'euros',
        aliases: ['eurocup', 'euro2024'],
        category: 'sports',
        description: 'Euros data — upcoming, matches, standings, scorers',
        usage: '.euros <upcoming|matches|standings|scorers>',

        async execute(sock, msg, args, extra) {
            extra.args = args;
            extra.command = 'euros';
            await leagueHandler(sock, msg, extra, '🏆 Euros', {
                upcoming:  { endpoint: '/euros/upcomingmatches', format: formatMatches,   title: 'Upcoming Matches' },
                matches:   { endpoint: '/euros/matches',         format: formatMatches,   title: 'Matches'          },
                standings: { endpoint: '/euros/standings',       format: formatStandings, title: 'Standings'        },
                scorers:   { endpoint: '/euros/scorers',         format: formatScorers,   title: 'Top Scorers'      },
            });
        },
    },

    // ── 20–23. FIFA ────────────────────────────────────────────────────────────
    {
        name: 'fifa',
        aliases: ['worldcup', 'fifawc'],
        category: 'sports',
        description: 'FIFA World Cup data — upcoming, matches, standings, scorers',
        usage: '.fifa <upcoming|matches|standings|scorers>',

        async execute(sock, msg, args, extra) {
            extra.args = args;
            extra.command = 'fifa';
            await leagueHandler(sock, msg, extra, '🌍 FIFA World Cup', {
                upcoming:  { endpoint: '/fifa/upcomingmatches', format: formatMatches,   title: 'Upcoming Matches' },
                matches:   { endpoint: '/fifa/matches',         format: formatMatches,   title: 'Matches'          },
                standings: { endpoint: '/fifa/standings',       format: formatStandings, title: 'Standings'        },
                scorers:   { endpoint: '/fifa/scorers',         format: formatScorers,   title: 'Top Scorers'      },
            });
        },
    },

    // ── 24–27. La Liga ─────────────────────────────────────────────────────────
    {
        name: 'laliga',
        aliases: ['ll', 'spanishleague'],
        category: 'sports',
        description: 'La Liga data — upcoming, matches, standings, scorers',
        usage: '.laliga <upcoming|matches|standings|scorers>',

        async execute(sock, msg, args, extra) {
            extra.args = args;
            extra.command = 'laliga';
            await leagueHandler(sock, msg, extra, '🇪🇸 La Liga', {
                upcoming:  { endpoint: '/laliga/upcomingmatches', format: formatMatches,   title: 'Upcoming Matches' },
                matches:   { endpoint: '/laliga/matches',         format: formatMatches,   title: 'Matches'          },
                standings: { endpoint: '/laliga/standings',       format: formatStandings, title: 'Standings'        },
                scorers:   { endpoint: '/laliga/scorers',         format: formatScorers,   title: 'Top Scorers'      },
            });
        },
    },

    // ── 28–31. Ligue 1 ────────────────────────────────────────────────────────
    {
        name: 'ligue1',
        aliases: ['ligue', 'frenchleague'],
        category: 'sports',
        description: 'Ligue 1 data — upcoming, matches, standings, scorers',
        usage: '.ligue1 <upcoming|matches|standings|scorers>',

        async execute(sock, msg, args, extra) {
            extra.args = args;
            extra.command = 'ligue1';
            await leagueHandler(sock, msg, extra, '🇫🇷 Ligue 1', {
                upcoming:  { endpoint: '/ligue1/upcomingmatches', format: formatMatches,   title: 'Upcoming Matches' },
                matches:   { endpoint: '/ligue1/matches',         format: formatMatches,   title: 'Matches'          },
                standings: { endpoint: '/ligue1/standings',       format: formatStandings, title: 'Standings'        },
                scorers:   { endpoint: '/ligue1/scorers',         format: formatScorers,   title: 'Top Scorers'      },
            });
        },
    },

    // ── 32–35. Serie A ─────────────────────────────────────────────────────────
    {
        name: 'seriea',
        aliases: ['seria', 'italianleague'],
        category: 'sports',
        description: 'Serie A data — upcoming, matches, standings, scorers',
        usage: '.seriea <upcoming|matches|standings|scorers>',

        async execute(sock, msg, args, extra) {
            extra.args = args;
            extra.command = 'seriea';
            await leagueHandler(sock, msg, extra, '🇮🇹 Serie A', {
                upcoming:  { endpoint: '/seriea/upcomingmatches', format: formatMatches,   title: 'Upcoming Matches' },
                matches:   { endpoint: '/seriea/matches',         format: formatMatches,   title: 'Matches'          },
                standings: { endpoint: '/seriea/standings',       format: formatStandings, title: 'Standings'        },
                scorers:   { endpoint: '/seriea/scorers',         format: formatScorers,   title: 'Top Scorers'      },
            });
        },
    },

    // ── 36–39. UCL ─────────────────────────────────────────────────────────────
    {
        name: 'ucl',
        aliases: ['championsleague', 'cl'],
        category: 'sports',
        description: 'UCL Champions League data — upcoming, matches, standings, scorers',
        usage: '.ucl <upcoming|matches|standings|scorers>',

        async execute(sock, msg, args, extra) {
            extra.args = args;
            extra.command = 'ucl';
            await leagueHandler(sock, msg, extra, '🏆 UCL Champions League', {
                upcoming:  { endpoint: '/ucl/upcomingmatches', format: formatMatches,   title: 'Upcoming Matches' },
                matches:   { endpoint: '/ucl/matches',         format: formatMatches,   title: 'Matches'          },
                standings: { endpoint: '/ucl/standings',       format: formatStandings, title: 'Standings'        },
                scorers:   { endpoint: '/ucl/scorers',         format: formatScorers,   title: 'Top Scorers'      },
            });
        },
    },

    // ── 40. Sure Bet Tips ──────────────────────────────────────────────────────
    {
        name: 'bet',
        aliases: ['surebets', 'bettips', 'betodd'],
        category: 'sports',
        description: 'Get sure bet tips and free odds',
        usage: '.bet',

        async execute(sock, msg, args, extra) {
            await react(sock, msg, '⏳');
            try {
                const data = await keithApi('/bet');
                const body = formatObj(data);
                await sendLong(sock, msg, `┏━━『 🎰 Sure Bet Tips & Free Odds 』━━`, body, `┗━━━━━━━━━━━━━━━━`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[bet]', err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ Failed: ${err.message}`);
            }
        },
    },

    // ── 41. Football News ──────────────────────────────────────────────────────
    {
        name: 'footballnews',
        aliases: ['fnews', 'sportnews'],
        category: 'sports',
        description: 'Get latest football news',
        usage: '.footballnews',

        async execute(sock, msg, args, extra) {
            await react(sock, msg, '⏳');
            try {
                const data = await keithApi('/football/news');
                const body = formatNews(data);
                await sendLong(sock, msg, `┏━━『 📰 Football News 』━━`, body, `┗━━━━━━━━━━━━━━━━`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[footballnews]', err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ Failed: ${err.message}`);
            }
        },
    },

];
