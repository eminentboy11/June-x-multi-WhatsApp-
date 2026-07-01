/**
 * Sports Commands — Powered by ravenn.site (Keith APIs)
 *
 * League commands  (.fifa | .epl | .ucl | .laliga | .seriea | .bundesliga | .ligue1 | .euros)
 *   Subcommands:   upcoming · scores · standings · scorers
 *
 * Special commands
 *   .livescore              — all live football scores
 *   .footballnews           — latest football news
 *   .bettips                — betting predictions & odds
 *   .playsearch  <name>     — search a player
 *   .clubsearch  <name>     — search a club / team
 *   .stadiumsearch <name>   — search a stadium / venue
 *   .matchevents <team vs team> — head-to-head match history
 */

const axios  = require('axios');
const { applyFont } = require('../../utils/fontConverter');

const BASE       = 'https://ravenn.site';
const TIMEOUT    = 20000;
const MAX_LEN    = 3800;

// ── Shared helpers ─────────────────────────────────────────────────────────────

const react = (sock, msg, emoji) =>
    sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } }).catch(() => {});

const send = (sock, jid, text, quoted) =>
    sock.sendMessage(jid, { text: applyFont(text) }, quoted ? { quoted } : undefined);

async function api(path) {
    const { data } = await axios.get(`${BASE}${path}`, { timeout: TIMEOUT });
    return data;
}

async function sendChunked(sock, jid, msg, lines) {
    const chunks = [];
    let cur = '';
    for (const line of lines) {
        if ((cur + line + '\n').length > MAX_LEN) {
            if (cur) chunks.push(cur.trimEnd());
            cur = '';
        }
        cur += line + '\n';
    }
    if (cur.trim()) chunks.push(cur.trimEnd());
    for (let i = 0; i < chunks.length; i++) {
        await send(sock, jid, chunks[i], i === 0 ? msg : undefined);
    }
}

// ── Formatters ─────────────────────────────────────────────────────────────────

function fmtStandings(data, label) {
    const rows = data?.result?.standings || [];
    if (!rows.length) return [`❌ No standings data available for ${label}.`];

    const lines = [
        `┏━━『 ${label} — STANDINGS 』━━`,
        '',
        `${'#'.padEnd(3)} ${'Team'.padEnd(26)} ${'P'.padEnd(3)}${'W'.padEnd(3)}${'D'.padEnd(3)}${'L'.padEnd(3)} GD   Pts`,
        '─'.repeat(52),
    ];

    for (const r of rows) {
        const pos = String(r.position || '').padEnd(3);
        const team = String(r.team || '???').slice(0, 25).padEnd(26);
        const p  = String(r.played  || 0).padEnd(3);
        const w  = String(r.won     || 0).padEnd(3);
        const d  = String(r.draw    || 0).padEnd(3);
        const l  = String(r.lost    || 0).padEnd(3);
        const gd = (r.goalsFor || 0) - (r.goalsAgainst || 0);
        const gdStr = String(gd >= 0 ? `+${gd}` : gd).padEnd(5);
        const pts = String(r.points || 0);
        lines.push(`${pos}${team}${p}${w}${d}${l}${gdStr}${pts}`);
    }

    lines.push('');
    lines.push('┗━━━━━━━━━━━━━━━━');
    return lines;
}

function fmtUpcoming(data, label) {
    const matches = data?.result?.upcomingMatches || [];
    if (!matches.length) return [`❌ No upcoming fixtures for ${label}.`];

    const lines = [
        `┏━━『 ${label} — UPCOMING FIXTURES 』━━`,
        '',
    ];

    for (const m of matches.slice(0, 25)) {
        const day  = m.matchday ? `MD${m.matchday}` : '';
        const home = m.homeTeam || '???';
        const away = m.awayTeam || '???';
        const date = m.date     || '';
        lines.push(`📅 ${home} 🆚 ${away}`);
        if (date) lines.push(`   🕐 ${date}${day ? '  ' + day : ''}`);
        lines.push('');
    }

    lines.push('┗━━━━━━━━━━━━━━━━');
    return lines;
}

function fmtScores(data, label) {
    const matches = data?.result?.matches || [];
    if (!matches.length) return [`❌ No match data for ${label}.`];

    const lines = [
        `┏━━『 ${label} — SCORES 』━━`,
        '',
    ];

    for (const m of matches.slice(0, 25)) {
        const home   = m.homeTeam || '???';
        const away   = m.awayTeam || '???';
        const score  = m.score   || '- -';
        const status = (m.status || '').toUpperCase();
        const icon   = status === 'FINISHED' ? '✅' : status === 'IN_PLAY' || status === 'LIVE' ? '🔴' : '⏳';
        const day    = m.matchday ? `MD${m.matchday}` : '';
        lines.push(`${icon} ${home} ${score} ${away}${day ? '  [' + day + ']' : ''}`);
    }

    lines.push('');
    lines.push('┗━━━━━━━━━━━━━━━━');
    return lines;
}

function fmtScorers(data, label) {
    const scorers = data?.result?.scorers || data?.result || [];
    const list = Array.isArray(scorers) ? scorers : [];
    if (!list.length) return [`❌ Top scorers not available for ${label} right now.`];

    const lines = [
        `┏━━『 ${label} — TOP SCORERS 』━━`,
        '',
    ];

    list.slice(0, 20).forEach((s, i) => {
        const name  = s.player?.name || s.name || '???';
        const team  = s.team?.name   || s.team || '';
        const goals = s.goals        || s.numberOfGoals || '?';
        lines.push(`${String(i + 1).padEnd(3)} ⚽ ${name}${team ? ' (' + team + ')' : ''}  — ${goals} goals`);
    });

    lines.push('');
    lines.push('┗━━━━━━━━━━━━━━━━');
    return lines;
}

// ── League command factory ─────────────────────────────────────────────────────

const LEAGUES = {
    fifa:       { prefix: '/fifa',        label: '🌍 FIFA World Cup',       aliases: ['wc', 'worldcup']            },
    epl:        { prefix: '/epl',         label: '⚽ Premier League',        aliases: ['premierleague', 'pl']       },
    ucl:        { prefix: '/ucl',         label: '🏆 Champions League',      aliases: ['championsleague', 'cl']     },
    laliga:     { prefix: '/laliga',      label: '🇪🇸 La Liga',             aliases: ['ll', 'spain']               },
    seriea:     { prefix: '/seriea',      label: '🇮🇹 Serie A',             aliases: ['serie', 'italy']            },
    bundesliga: { prefix: '/bundesliga',  label: '🇩🇪 Bundesliga',          aliases: ['bund', 'germany']           },
    ligue1:     { prefix: '/ligue1',      label: '🇫🇷 Ligue 1',            aliases: ['ligue', 'france']           },
    euros:      { prefix: '/euros',       label: '🇪🇺 UEFA Euros',          aliases: ['euro', 'euros2024']         },
};

const SUBS = ['upcoming', 'scores', 'standings', 'scorers'];

function makeLeagueCommand(name, { prefix, label, aliases }) {
    const helpText =
        `┏━━『 ${label} 』━━\n\n` +
        `Usage: *.${name} <option>*\n\n` +
        `  📅 *upcoming*   — Next fixtures\n` +
        `  📊 *scores*     — Results / live\n` +
        `  🏆 *standings*  — League table\n` +
        `  👟 *scorers*    — Top goal scorers\n\n` +
        `Example: *.${name} standings*\n\n` +
        `┗━━━━━━━━━━━━━━━━`;

    return {
        name,
        aliases,
        category: 'sports',
        description: `${label} — upcoming fixtures, scores, standings & top scorers`,
        usage: `.${name} <upcoming | scores | standings | scorers>`,

        async execute(sock, msg, args, extra) {
            const sub    = args[0]?.toLowerCase();
            const chatId = extra.from;

            if (!sub || !SUBS.includes(sub)) {
                return extra.reply(applyFont(helpText));
            }

            const emojiMap = { upcoming: '📅', scores: '📊', standings: '🏆', scorers: '👟' };
            await react(sock, msg, emojiMap[sub]);

            try {
                let path, lines;

                if (sub === 'upcoming') {
                    path  = `${prefix}/upcomingmatches`;
                    const data = await api(path);
                    if (!data.status) throw new Error(data.error || 'API error');
                    lines = fmtUpcoming(data, label);

                } else if (sub === 'scores') {
                    path  = `${prefix}/matches`;
                    const data = await api(path);
                    if (!data.status) throw new Error(data.error || 'API error');
                    lines = fmtScores(data, label);

                } else if (sub === 'standings') {
                    path  = `${prefix}/standings`;
                    const data = await api(path);
                    if (!data.status) throw new Error(data.error || 'API error');
                    lines = fmtStandings(data, label);

                } else if (sub === 'scorers') {
                    path  = `${prefix}/scorers`;
                    const data = await api(path);
                    if (!data.status) throw new Error(data.error || 'API error');
                    lines = fmtScorers(data, label);
                }

                await sendChunked(sock, chatId, msg, lines);
                await react(sock, msg, '✅');

            } catch (err) {
                console.error(`[${name} ${sub}]`, err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ Could not fetch ${label} ${sub}: ${err.message}`);
            }
        },
    };
}

// ── Special commands ───────────────────────────────────────────────────────────

const livescoreCmd = {
    name: 'livescore',
    aliases: ['live', 'livenow'],
    category: 'sports',
    description: 'All live football scores right now',
    usage: '.livescore',

    async execute(sock, msg, args, extra) {
        await react(sock, msg, '🔴');
        try {
            const data = await api('/livescore');
            if (!data.status) throw new Error(data.error || 'API error');

            const games = data.result?.games || {};
            const list  = Object.values(games);

            if (!list.length) {
                return send(sock, extra.from,
                    `┏━━『 🔴 LIVE SCORES 』━━\n\nNo live matches at the moment.\n\n┗━━━━━━━━━━━━━━━━`, msg);
            }

            const lines = [`┏━━『 🔴 LIVE SCORES (${list.length} matches) 』━━`, ''];

            for (const g of list) {
                const home  = g.p1 || '???';
                const away  = g.p2 || '???';
                const hs    = g.l1 != null && g.l1 !== '' ? g.l1 : '-';
                const as    = g.l2 != null && g.l2 !== '' ? g.l2 : '-';
                const time  = g.tm  || '';
                const date  = g.dt  || '';
                lines.push(`🔴 ${home} ${hs} - ${as} ${away}`);
                if (date || time) lines.push(`   📅 ${date} ${time}`.trimEnd());
                lines.push('');
            }

            lines.push('┗━━━━━━━━━━━━━━━━');
            await sendChunked(sock, extra.from, msg, lines);
            await react(sock, msg, '✅');

        } catch (err) {
            console.error('[livescore]', err.message);
            await react(sock, msg, '❌');
            extra.reply(`❌ Could not fetch live scores: ${err.message}`);
        }
    },
};

const footballNewsCmd = {
    name: 'footballnews',
    aliases: ['fnews', 'sportnews'],
    category: 'sports',
    description: 'Latest football news headlines',
    usage: '.footballnews',

    async execute(sock, msg, args, extra) {
        await react(sock, msg, '📰');
        try {
            const data = await api('/football/news');
            if (!data.status) throw new Error(data.error || 'API error');

            const items = data.result?.data?.items || [];
            if (!items.length) {
                return send(sock, extra.from, `┏━━『 📰 FOOTBALL NEWS 』━━\n\nNo news available.\n\n┗━━━━━━━━━━━━━━━━`, msg);
            }

            const lines = [`┏━━『 📰 FOOTBALL NEWS 』━━`, ''];

            for (const item of items.slice(0, 10)) {
                const title  = item.t || item.title   || item.headline || 'No title';
                const source = item.s || item.source  || '';
                const url    = item.u || item.url     || item.link || '';
                lines.push(`📌 ${title}`);
                if (source) lines.push(`   📡 ${source}`);
                if (url)    lines.push(`   🔗 ${url}`);
                lines.push('');
            }

            lines.push('┗━━━━━━━━━━━━━━━━');
            await sendChunked(sock, extra.from, msg, lines);
            await react(sock, msg, '✅');

        } catch (err) {
            console.error('[footballnews]', err.message);
            await react(sock, msg, '❌');
            extra.reply(`❌ Could not fetch football news: ${err.message}`);
        }
    },
};

const betTipsCmd = {
    name: 'bettips',
    aliases: ['bet', 'odds', 'predictions'],
    category: 'sports',
    description: 'Sure bet tips and match predictions with odds',
    usage: '.bettips',

    async execute(sock, msg, args, extra) {
        await react(sock, msg, '🎯');
        try {
            const data = await api('/bet');
            if (!data.status) throw new Error(data.error || 'API error');

            const tips = data.result || [];
            if (!tips.length) {
                return send(sock, extra.from, `┏━━『 🎯 BET TIPS 』━━\n\nNo tips available right now.\n\n┗━━━━━━━━━━━━━━━━`, msg);
            }

            const lines = [`┏━━『 🎯 BET TIPS & PREDICTIONS 』━━`, ''];

            for (const tip of tips.slice(0, 15)) {
                const match  = tip.match  || '???';
                const league = tip.league || '';
                const time   = tip.time   || '';
                const ft     = tip.predictions?.fulltime    || {};
                const o25    = tip.predictions?.over_2_5    || {};
                const btts   = tip.predictions?.bothTeamToScore || {};
                const result = tip.result;

                lines.push(`⚽ *${match}*`);
                if (league) lines.push(`   🏆 ${league}`);
                if (time)   lines.push(`   🕐 ${time}`);
                if (ft.home !== undefined) {
                    lines.push(`   📊 1X2: Home ${ft.home}%  Draw ${ft.draw}%  Away ${ft.away}%`);
                }
                if (o25.yes !== undefined) lines.push(`   📈 Over 2.5: ${o25.yes}%`);
                if (btts.yes !== undefined) lines.push(`   🥅 BTTS: ${btts.yes}%`);
                if (result !== null && result !== undefined) lines.push(`   ✅ Result: ${result}`);
                lines.push('');
            }

            lines.push('⚠️ Tips are predictions only. Bet responsibly.');
            lines.push('┗━━━━━━━━━━━━━━━━');
            await sendChunked(sock, extra.from, msg, lines);
            await react(sock, msg, '✅');

        } catch (err) {
            console.error('[bettips]', err.message);
            await react(sock, msg, '❌');
            extra.reply(`❌ Could not fetch bet tips: ${err.message}`);
        }
    },
};

const playSearchCmd = {
    name: 'playsearch',
    aliases: ['psearch', 'findplaya'],
    category: 'sports',
    description: 'Search for a sports player by name',
    usage: '.playsearch <player name>',

    async execute(sock, msg, args, extra) {
        const query = args.join(' ').trim();
        if (!query) return extra.reply(applyFont(
            `┏━━『 🔍 PLAYER SEARCH 』━━\n\nUsage: *.playsearch <name>*\n\nExample: *.playsearch Bukayo Saka*\n\n┗━━━━━━━━━━━━━━━━`
        ));

        await react(sock, msg, '🔍');
        try {
            const data = await api(`/sport/playersearch?q=${encodeURIComponent(query)}`);
            if (!data.status) throw new Error(data.error || 'API error');

            const players = data.result || [];
            if (!players.length) {
                return send(sock, extra.from, `❌ No players found for *"${query}"*`, msg);
            }

            const lines = [`┏━━『 🔍 PLAYER SEARCH: "${query}" 』━━`, ''];

            for (const p of players.slice(0, 8)) {
                const name  = p.name  || '???';
                const team  = p.team  || '';
                const sport = p.sport || '';
                const nat   = p.nationality || p.strNationality || '';
                const pos   = p.position    || p.strPosition    || '';
                const born  = p.dateBorn    || '';
                const id    = p.id          || '';
                lines.push(`👤 *${name}*`);
                if (team)  lines.push(`   🏟️ Team: ${team}`);
                if (sport) lines.push(`   🏅 Sport: ${sport}`);
                if (nat)   lines.push(`   🌍 Nationality: ${nat}`);
                if (pos)   lines.push(`   📍 Position: ${pos}`);
                if (born)  lines.push(`   🎂 Born: ${born}`);
                if (id)    lines.push(`   🆔 ID: ${id}`);
                lines.push('');
            }

            lines.push('┗━━━━━━━━━━━━━━━━');
            await sendChunked(sock, extra.from, msg, lines);
            await react(sock, msg, '✅');

        } catch (err) {
            console.error('[playsearch]', err.message);
            await react(sock, msg, '❌');
            extra.reply(`❌ Player search failed: ${err.message}`);
        }
    },
};

const clubSearchCmd = {
    name: 'clubsearch',
    aliases: ['csearch', 'findclub'],
    category: 'sports',
    description: 'Search for a sports team / club by name',
    usage: '.clubsearch <team name>',

    async execute(sock, msg, args, extra) {
        const query = args.join(' ').trim();
        if (!query) return extra.reply(applyFont(
            `┏━━『 🔍 CLUB SEARCH 』━━\n\nUsage: *.clubsearch <name>*\n\nExample: *.clubsearch Arsenal*\n\n┗━━━━━━━━━━━━━━━━`
        ));

        await react(sock, msg, '🏟️');
        try {
            const data = await api(`/sport/teamsearch?q=${encodeURIComponent(query)}`);
            if (!data.status) throw new Error(data.error || 'API error');

            const teams = data.result || [];
            if (!teams.length) {
                return send(sock, extra.from, `❌ No clubs found for *"${query}"*`, msg);
            }

            const lines = [`┏━━『 🏟️ CLUB SEARCH: "${query}" 』━━`, ''];

            for (const t of teams.slice(0, 8)) {
                const name   = t.name         || '???';
                const short  = t.shortName    || '';
                const league = t.league       || t.strLeague || '';
                const sport  = t.sport        || '';
                const formed = t.formedYear   || '';
                const nation = t.country      || t.strCountry || '';
                const id     = t.id           || '';
                lines.push(`🏟️ *${name}*${short && short !== name ? ' (' + short + ')' : ''}`);
                if (league) lines.push(`   🏆 League: ${league}`);
                if (sport)  lines.push(`   🏅 Sport: ${sport}`);
                if (nation) lines.push(`   🌍 Country: ${nation}`);
                if (formed) lines.push(`   📅 Founded: ${formed}`);
                if (id)     lines.push(`   🆔 ID: ${id}`);
                lines.push('');
            }

            lines.push('┗━━━━━━━━━━━━━━━━');
            await sendChunked(sock, extra.from, msg, lines);
            await react(sock, msg, '✅');

        } catch (err) {
            console.error('[clubsearch]', err.message);
            await react(sock, msg, '❌');
            extra.reply(`❌ Club search failed: ${err.message}`);
        }
    },
};

const stadiumSearchCmd = {
    name: 'stadiumsearch',
    aliases: ['venuesearch', 'groundsearch'],
    category: 'sports',
    description: 'Search for a stadium or venue by name',
    usage: '.stadiumsearch <venue name>',

    async execute(sock, msg, args, extra) {
        const query = args.join(' ').trim();
        if (!query) return extra.reply(applyFont(
            `┏━━『 🏟️ STADIUM SEARCH 』━━\n\nUsage: *.stadiumsearch <name>*\n\nExample: *.stadiumsearch Emirates*\n\n┗━━━━━━━━━━━━━━━━`
        ));

        await react(sock, msg, '🏟️');
        try {
            const data = await api(`/sport/venuesearch?q=${encodeURIComponent(query)}`);
            if (!data.status) throw new Error(data.error || 'API error');

            const venues = data.result || [];
            if (!venues.length) {
                return send(sock, extra.from, `❌ No venues found for *"${query}"*`, msg);
            }

            const lines = [`┏━━『 🏟️ STADIUM SEARCH: "${query}" 』━━`, ''];

            for (const v of venues.slice(0, 6)) {
                const name  = v.name        || '???';
                const alt   = v.alternateName || '';
                const sport = v.sport        || '';
                const sponsor = v.sponsor    || '';
                const desc  = v.description  || '';
                lines.push(`🏟️ *${name}*`);
                if (alt)     lines.push(`   🔤 Also: ${alt}`);
                if (sport)   lines.push(`   🏅 Sport: ${sport}`);
                if (sponsor) lines.push(`   💼 Sponsor: ${sponsor}`);
                if (desc)    lines.push(`   📝 ${desc.slice(0, 200)}${desc.length > 200 ? '...' : ''}`);
                lines.push('');
            }

            lines.push('┗━━━━━━━━━━━━━━━━');
            await sendChunked(sock, extra.from, msg, lines);
            await react(sock, msg, '✅');

        } catch (err) {
            console.error('[stadiumsearch]', err.message);
            await react(sock, msg, '❌');
            extra.reply(`❌ Stadium search failed: ${err.message}`);
        }
    },
};

const matchEventsCmd = {
    name: 'matchevents',
    aliases: ['h2h', 'gameevents'],
    category: 'sports',
    description: 'Head-to-head match history between two teams',
    usage: '.matchevents <Team A vs Team B>',

    async execute(sock, msg, args, extra) {
        const query = args.join(' ').trim();
        if (!query || !query.toLowerCase().includes('vs')) {
            return extra.reply(applyFont(
                `┏━━『 ⚽ MATCH EVENTS 』━━\n\nUsage: *.matchevents <Team A vs Team B>*\n\nExample: *.matchevents Arsenal vs Chelsea*\n\n┗━━━━━━━━━━━━━━━━`
            ));
        }

        await react(sock, msg, '⚽');
        try {
            const data = await api(`/sport/gameevents?q=${encodeURIComponent(query)}`);
            if (!data.status) throw new Error(data.error || 'API error');

            const events = data.result || [];
            if (!events.length) {
                return send(sock, extra.from, `❌ No match history found for *"${query}"*`, msg);
            }

            const lines = [`┏━━『 ⚽ MATCH HISTORY: ${query.toUpperCase()} 』━━`, ''];

            for (const e of events.slice(0, 10)) {
                const match  = e.match           || e.alternateMatchName || '???';
                const sport  = e.sport           || '';
                const league = e.league?.name    || '';
                const date   = e.dateEvent       || '';
                const score  = e.intHomeScore !== undefined
                    ? `${e.intHomeScore} - ${e.intAwayScore}`
                    : '';
                lines.push(`📋 *${match}*`);
                if (league) lines.push(`   🏆 ${league}`);
                if (sport)  lines.push(`   🏅 ${sport}`);
                if (date)   lines.push(`   📅 ${date}`);
                if (score)  lines.push(`   🔢 Score: ${score}`);
                if (e.id)   lines.push(`   🆔 Event ID: ${e.id}`);
                lines.push('');
            }

            lines.push(`📊 Showing ${Math.min(events.length, 10)} of ${events.length} events`);
            lines.push('┗━━━━━━━━━━━━━━━━');
            await sendChunked(sock, extra.from, msg, lines);
            await react(sock, msg, '✅');

        } catch (err) {
            console.error('[matchevents]', err.message);
            await react(sock, msg, '❌');
            extra.reply(`❌ Could not fetch match history: ${err.message}`);
        }
    },
};

// ── Exports ────────────────────────────────────────────────────────────────────

module.exports = [
    // League commands (upcoming · scores · standings · scorers)
    ...Object.entries(LEAGUES).map(([name, cfg]) => makeLeagueCommand(name, cfg)),

    // Special commands
    livescoreCmd,
    footballNewsCmd,
    betTipsCmd,
    playSearchCmd,
    clubSearchCmd,
    stadiumSearchCmd,
    matchEventsCmd,
];
