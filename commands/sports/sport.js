/**
 * Sport Commands — Powered by Keith API (ravenn.site/sports)
 * Covers all endpoints including FIFA World Cup full group stage
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
        const part   = chunks.length > 1 ? ` (${i + 1}/${chunks.length})` : '';
        const isLast = i === chunks.length - 1;
        const text =
            (i === 0 ? `${header}${part}\n\n` : `${header}${part} cont...\n\n`) +
            chunks[i] +
            (isLast ? `\n${footer}` : '');
        await sock.sendMessage(msg.key.remoteJid, { text }, { quoted: i === 0 ? msg : undefined });
    }
}

// ── Country flag helper ────────────────────────────────────────────────────────

function countryFlag(name = '') {
    const n = name.toLowerCase();
    const flags = {
        'argentina': '🇦🇷', 'australia': '🇦🇺', 'belgium': '🇧🇪', 'brazil': '🇧🇷',
        'cameroon': '🇨🇲', 'canada': '🇨🇦', 'chile': '🇨🇱', 'colombia': '🇨🇴',
        'costa rica': '🇨🇷', 'croatia': '🇭🇷', 'denmark': '🇩🇰', 'ecuador': '🇪🇨',
        'egypt': '🇪🇬', 'england': '🏴󠁧󠁢󠁥󠁮󠁧󠁿', 'france': '🇫🇷', 'germany': '🇩🇪',
        'ghana': '🇬🇭', 'iran': '🇮🇷', 'italy': '🇮🇹', 'japan': '🇯🇵',
        'kenya': '🇰🇪', 'mexico': '🇲🇽', 'morocco': '🇲🇦', 'netherlands': '🇳🇱',
        'nigeria': '🇳🇬', 'paraguay': '🇵🇾', 'peru': '🇵🇪', 'poland': '🇵🇱',
        'portugal': '🇵🇹', 'qatar': '🇶🇦', 'saudi arabia': '🇸🇦', 'senegal': '🇸🇳',
        'serbia': '🇷🇸', 'south korea': '🇰🇷', 'spain': '🇪🇸', 'switzerland': '🇨🇭',
        'tunisia': '🇹🇳', 'turkey': '🇹🇷', 'ukraine': '🇺🇦', 'united states': '🇺🇸',
        'usa': '🇺🇸', 'uruguay': '🇺🇾', 'wales': '🏴󠁧󠁢󠁷󠁬󠁳󠁿',
    };
    for (const [country, flag] of Object.entries(flags)) {
        if (n.includes(country)) return flag;
    }
    return '🏳️';
}

// ── Formatters ─────────────────────────────────────────────────────────────────

function fmtPlayers(result) {
    const arr = Array.isArray(result) ? result : [];
    if (!arr.length) return '_No players found_';
    return arr.slice(0, 10).map((p, i) => {
        let t = `*${i + 1}. ${p.name || p.strPlayer || 'Unknown'}*\n`;
        if (p.team)        t += `   🏟️ Team: ${p.team}\n`;
        if (p.sport)       t += `   🏅 Sport: ${p.sport}\n`;
        if (p.nationality) t += `   🌍 Nationality: ${p.nationality}\n`;
        if (p.position)    t += `   📍 Position: ${p.position}\n`;
        if (p.birthDate)   t += `   🎂 Born: ${p.birthDate}\n`;
        if (p.status)      t += `   ✅ Status: ${p.status}\n`;
        return t;
    }).join('\n');
}

function fmtTeams(result) {
    const arr = Array.isArray(result) ? result : [];
    if (!arr.length) return '_No teams found_';
    return arr.slice(0, 5).map((t, i) => {
        let s = `*${i + 1}. ${t.name || 'Unknown'}*\n`;
        if (t.league)          s += `   🏆 League: ${t.league}\n`;
        if (t.sport)           s += `   🏅 Sport: ${t.sport}\n`;
        if (t.stadium)         s += `   🏟️ Stadium: ${t.stadium}\n`;
        if (t.stadiumCapacity) s += `   👥 Capacity: ${Number(t.stadiumCapacity).toLocaleString()}\n`;
        if (t.location)        s += `   📍 Location: ${t.location}\n`;
        if (t.country)         s += `   🌍 Country: ${t.country}\n`;
        if (t.formedYear)      s += `   📅 Founded: ${t.formedYear}\n`;
        if (t.social?.website) s += `   🌐 ${t.social.website}\n`;
        if (t.description) {
            const desc = String(t.description).slice(0, 200).trim();
            s += `   📝 ${desc}...\n`;
        }
        return s;
    }).join('\n');
}

function fmtVenues(result) {
    const arr = Array.isArray(result) ? result : [];
    if (!arr.length) return '_No venues found_';
    return arr.slice(0, 5).map((v, i) => {
        let s = `*${i + 1}. ${v.name || 'Unknown'}*\n`;
        if (v.sport)    s += `   🏅 Sport: ${v.sport}\n`;
        if (v.capacity) s += `   👥 Capacity: ${Number(v.capacity).toLocaleString()}\n`;
        if (v.location) s += `   📍 Location: ${v.location}\n`;
        if (v.country)  s += `   🌍 Country: ${v.country}\n`;
        if (v.description) {
            const desc = String(v.description).slice(0, 200).trim();
            s += `   📝 ${desc}...\n`;
        }
        return s;
    }).join('\n');
}

function fmtGameEvents(result) {
    const arr = Array.isArray(result) ? result : [];
    if (!arr.length) return '_No events found_';
    return arr.slice(0, 10).map(e => {
        const home   = e.teams?.home?.name || e.homeTeam || '?';
        const away   = e.teams?.away?.name || e.awayTeam || '?';
        const hs     = e.teams?.home?.score;
        const as_    = e.teams?.away?.score;
        const date   = e.dateTime?.date || e.date || '';
        const time   = e.dateTime?.time?.slice(0, 5) || '';
        const venue  = e.venue?.name || '';
        const status = e.status || '';
        const season = e.season || '';
        let s = `┏ *${home}* vs *${away}*\n`;
        if (hs !== null && hs !== undefined && as_ !== null && as_ !== undefined)
            s += `┃ 📊 Score: ${hs} - ${as_}\n`;
        if (date)   s += `┃ 📅 ${date}${time ? ' ' + time : ''}\n`;
        if (venue)  s += `┃ 🏟️ ${venue}\n`;
        if (status) s += `┃ 🔄 ${status}\n`;
        if (season) s += `┃ 📋 Season: ${season}\n`;
        s += `┗━━━━━━━━━━━━━━━\n`;
        return s;
    }).join('\n');
}

function fmtStandings(result) {
    const arr = result?.standings || (Array.isArray(result) ? result : []);
    if (!arr.length) return '_No standings data available_';
    const comp = result?.competition ? `${result.competition}\n\n` : '';
    const rows = arr.slice(0, 25).map(r => {
        const pos  = String(r.position || r.pos || '').padStart(2);
        const team = (r.team || r.name || '?').padEnd(28);
        const p    = r.played ?? r.mp ?? 0;
        const w    = r.won   ?? r.w  ?? 0;
        const d    = r.draw  ?? r.drawn ?? r.d ?? 0;
        const l    = r.lost  ?? r.l  ?? 0;
        const pts  = r.points ?? r.pts ?? 0;
        const gd   = r.goalDifference ?? r.gd ?? '';
        return `${pos}. ${team} P${p} W${w} D${d} L${l}${gd !== '' ? ' GD' + gd : ''} | *${pts}pts*`;
    });
    return comp + rows.join('\n');
}

function fmtScorers(result) {
    const arr = result?.topScorers || result?.scorers || (Array.isArray(result) ? result : []);
    if (!arr.length) return '_No scorers data available_';
    const comp = result?.competition ? `${result.competition}\n\n` : '';
    const rows = arr.slice(0, 20).map((s, i) => {
        const rank    = s.rank || s.position || (i + 1);
        const player  = s.player || s.name || s.strPlayer || '?';
        const team    = s.team || s.club || '';
        const goals   = s.goals ?? s.scored ?? s.numberOfGoals ?? '?';
        const assists = s.assists ?? '';
        let t = `*${rank}.* ⚽ ${player}${team ? ` (${team})` : ''}\n`;
        t += `    Goals: *${goals}*${assists !== '' ? ` │ Assists: ${assists}` : ''}\n`;
        return t;
    });
    return comp + rows.join('');
}

function fmtMatches(result) {
    const matches = result?.upcomingMatches || result?.matches || result?.fixtures ||
                    (Array.isArray(result) ? result : []);
    if (!matches.length) return '_No matches data available_';
    const comp = result?.competition ? `${result.competition}\n\n` : '';
    const rows = matches.slice(0, 15).map(m => {
        const home  = m.homeTeam || m.home || m.team1 || '?';
        const away  = m.awayTeam || m.away || m.team2 || '?';
        const score = m.score || (m.homeScore !== undefined ? `${m.homeScore} - ${m.awayScore}` : null);
        const date  = m.date || m.utcDate || '';
        const day   = m.matchday ? `MD${m.matchday}` : '';
        let s = `┏ ${home} vs ${away}\n`;
        if (score) s += `┃ 📊 ${score}\n`;
        if (day)   s += `┃ 📋 ${day}\n`;
        if (date)  s += `┃ 📅 ${date}\n`;
        s += `┗━━━━━━━━━━━━━━━\n`;
        return s;
    });
    return comp + rows.join('\n');
}

function fmtLivescore(result) {
    const gamesObj = result?.games || result;
    let games = Array.isArray(gamesObj) ? gamesObj : Object.values(gamesObj || {});
    if (!games.length) return '_No live games right now_';
    return games.slice(0, 20).map(g => {
        const home   = g.p1 || g.home || '?';
        const away   = g.p2 || g.away || '?';
        const s1     = g.R?.r1 ?? g.homeScore ?? '';
        const s2     = g.R?.r2 ?? g.awayScore ?? '';
        const status = g.R?.st || g.status || '';
        const date   = g.dt || '';
        const time   = g.tm || '';
        let s = `┏ ${home} *${s1}* - *${s2}* ${away}\n`;
        if (status) s += `┃ ⏱ ${status}\n`;
        if (date)   s += `┃ 📅 ${date}${time ? ' ' + time : ''}\n`;
        s += `┗━━━━━━━━━━━━━━━\n`;
        return s;
    }).join('\n');
}

function fmtLivescore2(result) {
    const list = result?.data?.list || result?.list || (Array.isArray(result) ? result : []);
    if (!list.length) return '_No live highlights right now_';
    return list.slice(0, 15).map(g => {
        const t1     = g.team1?.name || '?';
        const t2     = g.team2?.name || '?';
        const s1     = g.team1?.score ?? '';
        const s2     = g.team2?.score ?? '';
        const status = g.status || '';
        let s = `┏ ${t1} *${s1}* - *${s2}* ${t2}\n`;
        if (status)    s += `┃ 🔴 ${status}\n`;
        if (g.playPath) s += `┃ 🎬 ${g.playPath}\n`;
        s += `┗━━━━━━━━━━━━━━━\n`;
        return s;
    }).join('\n');
}

function fmtNews(result) {
    const items = result?.data?.items || result?.items || (Array.isArray(result) ? result : []);
    if (!items.length) return '_No news available_';
    return items.slice(0, 10).map((n, i) => {
        const title   = n.title || n.headline || '';
        const summary = n.summary || n.description || '';
        const date    = n.date || (n.createdAt ? new Date(Number(n.createdAt)).toLocaleDateString() : '');
        let s = `*${i + 1}. ${title}*\n`;
        if (date)    s += `📅 ${date}\n`;
        if (summary) s += `${String(summary).slice(0, 250)}\n`;
        return s + '\n';
    }).join('');
}

function fmtBet(result) {
    const arr = Array.isArray(result) ? result : (result?.tips || result?.bets || []);
    if (!arr.length) return '_No bet tips available right now. Try again later._';
    return arr.slice(0, 15).map((b, i) => {
        const match = b.match || b.game || b.fixture || `Match ${i + 1}`;
        const tip   = b.tip || b.prediction || b.pick || '';
        const odds  = b.odds || b.odd || '';
        const conf  = b.confidence || b.probability || '';
        let s = `*${i + 1}. ${match}*\n`;
        if (tip)  s += `   🎯 Tip: ${tip}\n`;
        if (odds) s += `   💰 Odds: ${odds}\n`;
        if (conf) s += `   📊 Confidence: ${conf}\n`;
        return s;
    }).join('\n');
}

function fmtFifaStandings(result) {
    if (!result) return '_No FIFA data available_';
    const groups = result.groups || result.table || result.standings;
    if (Array.isArray(groups) && groups.length) return fmtStandings({ standings: groups });
    const details = result.details || result;
    let s = `🌍 *FIFA World Cup 2026*\n\n`;
    if (details.name)           s += `🏆 Competition: ${details.name}\n`;
    if (details.selectedSeason) s += `📅 Season: ${details.selectedSeason}\n`;
    if (details.country)        s += `🌍 Country: ${details.country}\n`;
    const seasons = result.allAvailableSeasons;
    if (seasons?.length)        s += `\n📋 Available seasons: ${seasons.slice(0, 5).join(', ')}\n`;
    return s;
}

// ── World Cup group stage formatter ───────────────────────────────────────────

function fmtWorldCupGroups(result) {
    // ── Extract group map from various API response shapes ─────────────────
    let groupMap = {}; // { 'A': [...teams], 'B': [...teams], ... }

    // Shape 1: result.groups = [ { group: 'A', standings: [...] }, ... ]
    if (Array.isArray(result?.groups)) {
        for (const g of result.groups) {
            const label = (g.group || g.name || g.stage || '').replace(/Group\s*/i, '').trim();
            const teams = g.standings || g.teams || g.table || [];
            if (label && teams.length) groupMap[label] = teams;
        }
    }

    // Shape 2: result.standings is a flat array with a 'group' field per row
    if (!Object.keys(groupMap).length && Array.isArray(result?.standings)) {
        for (const row of result.standings) {
            const g = (row.group || row.stage || '').replace(/Group\s*/i, '').trim();
            if (!g) continue;
            if (!groupMap[g]) groupMap[g] = [];
            groupMap[g].push(row);
        }
    }

    // Shape 3: flat top-level array with group field
    if (!Object.keys(groupMap).length && Array.isArray(result)) {
        for (const row of result) {
            const g = (row.group || row.stage || '').replace(/Group\s*/i, '').trim();
            if (!g) continue;
            if (!groupMap[g]) groupMap[g] = [];
            groupMap[g].push(row);
        }
    }

    const groupKeys = Object.keys(groupMap).sort();

    if (!groupKeys.length) {
        // No group breakdown — show raw overview with a note
        return fmtFifaStandings(result) +
            '\n\n_ℹ️ Full group breakdown not yet released by API._';
    }

    // ── Build grouped table ────────────────────────────────────────────────
    let body = '';

    for (const key of groupKeys) {
        const teams = groupMap[key];

        body += `🔷 *GROUP ${key}*\n`;
        body += `${'─'.repeat(44)}\n`;
        body += `${'Team'.padEnd(22)} MP  W  D  L  GF GA GD Pts\n`;

        teams.forEach((t, idx) => {
            const name = (t.team || t.name || t.country || '?').slice(0, 20).padEnd(22);
            const mp   = String(t.played        ?? t.mp  ?? t.pld ?? 0).padStart(2);
            const w    = String(t.won           ?? t.w   ?? 0).padStart(2);
            const d    = String(t.draw          ?? t.drawn ?? t.d ?? 0).padStart(2);
            const l    = String(t.lost          ?? t.l   ?? 0).padStart(2);
            const gf   = String(t.goalsFor      ?? t.gf  ?? t.scored    ?? 0).padStart(3);
            const ga   = String(t.goalsAgainst  ?? t.ga  ?? t.conceded  ?? 0).padStart(3);
            const gd   = String(t.goalDifference ?? t.gd ?? 0).padStart(3);
            const pts  = String(t.points        ?? t.pts ?? 0).padStart(3);
            const flag = countryFlag(t.team || t.name || t.country || '');

            // Top 2 advance marker
            const marker = idx < 2 ? '✅' : '  ';

            body += `${marker}${flag} ${name}${mp} ${w} ${d} ${l} ${gf}${ga}${gd}${pts}\n`;
        });

        body += '\n';
    }

    return body;
}

// ── League sub-command handler ─────────────────────────────────────────────────

async function leagueHandler(sock, msg, args, extra, label, endpoints) {
    const sub       = (args[0] || '').toLowerCase();
    const validSubs = Object.keys(endpoints);

    if (!sub || !validSubs.includes(sub)) {
        return send(sock, msg,
            `┏━━『 ${label} 』━━\n\n` +
            `Usage: .${extra.command} <option>\n\n` +
            `Options:\n` + validSubs.map(s => `  • *${s}*`).join('\n') +
            `\n\n┗━━━━━━━━━━━━━━━━`
        );
    }

    await react(sock, msg, '⏳');
    try {
        const { endpoint, format, title } = endpoints[sub];
        const result = await keithApi(endpoint);
        const body   = format(result);
        await sendLong(sock, msg, `┏━━『 ${label} — ${title} 』━━`, body);
        await react(sock, msg, '✅');
    } catch (err) {
        console.error(`[${label}/${sub}]`, err.message);
        await react(sock, msg, '❌');
        extra.reply(`❌ ${label} ${sub} failed: ${err.message}`);
    }
}

// ── Commands ───────────────────────────────────────────────────────────────────

module.exports = [

    // ── 1. Player Search ───────────────────────────────────────────────────────
    {
        name: 'playersearch',
        aliases: ['psearch', 'kplayer'],
        category: 'sports',
        description: 'Search for any sport player',
        usage: '.playersearch <player name>',
        async execute(sock, msg, args, extra) {
            const q = args.join(' ').trim();
            if (!q) return extra.reply('❌ Provide a player name.\n\nExample: *.playersearch Bukayo Saka*');
            await react(sock, msg, '🔍');
            try {
                const result = await keithApi('/sport/playersearch', { q });
                await sendLong(sock, msg, `┏━━『 🔍 Player Search: "${q}" 』━━`, fmtPlayers(result));
                await react(sock, msg, '✅');
            } catch (err) {
                await react(sock, msg, '❌');
                extra.reply(`❌ Search failed: ${err.message}`);
            }
        },
    },

    // ── 2. Team Search ─────────────────────────────────────────────────────────
    {
        name: 'kteamsearch',
        aliases: ['tsearch', 'kteam'],
        category: 'sports',
        description: 'Search for any sport team',
        usage: '.kteamsearch <team name>',
        async execute(sock, msg, args, extra) {
            const q = args.join(' ').trim();
            if (!q) return extra.reply('❌ Provide a team name.\n\nExample: *.kteamsearch Arsenal*');
            await react(sock, msg, '🔍');
            try {
                const result = await keithApi('/sport/teamsearch', { q });
                await sendLong(sock, msg, `┏━━『 🔍 Team Search: "${q}" 』━━`, fmtTeams(result));
                await react(sock, msg, '✅');
            } catch (err) {
                await react(sock, msg, '❌');
                extra.reply(`❌ Search failed: ${err.message}`);
            }
        },
    },

    // ── 3. Venue Search ────────────────────────────────────────────────────────
    {
        name: 'venuesearch',
        aliases: ['stadium', 'findvenue'],
        category: 'sports',
        description: 'Search for a stadium/venue',
        usage: '.venuesearch <venue name>',
        async execute(sock, msg, args, extra) {
            const q = args.join(' ').trim();
            if (!q) return extra.reply('❌ Provide a venue name.\n\nExample: *.venuesearch Emirates*');
            await react(sock, msg, '🔍');
            try {
                const result = await keithApi('/sport/venuesearch', { q });
                await sendLong(sock, msg, `┏━━『 🏟️ Venue Search: "${q}" 』━━`, fmtVenues(result));
                await react(sock, msg, '✅');
            } catch (err) {
                await react(sock, msg, '❌');
                extra.reply(`❌ Search failed: ${err.message}`);
            }
        },
    },

    // ── 4. Game Events / H2H ───────────────────────────────────────────────────
    {
        name: 'gameevents',
        aliases: ['matchhistory', 'h2h'],
        category: 'sports',
        description: 'Game events/history between two teams',
        usage: '.gameevents <team vs team>',
        async execute(sock, msg, args, extra) {
            const q = args.join(' ').trim();
            if (!q) return extra.reply('❌ Provide a match query.\n\nExample: *.gameevents Arsenal vs Chelsea*');
            await react(sock, msg, '⏳');
            try {
                const result = await keithApi('/sport/gameevents', { q });
                await sendLong(sock, msg, `┏━━『 📋 Game Events: "${q}" 』━━`, fmtGameEvents(result));
                await react(sock, msg, '✅');
            } catch (err) {
                await react(sock, msg, '❌');
                extra.reply(`❌ Failed: ${err.message}`);
            }
        },
    },

    // ── 5. FIFA 2026 Standings Overview ────────────────────────────────────────
    {
        name: 'fifastandings',
        aliases: ['fifa2026', 'worldcup2026'],
        category: 'sports',
        description: 'Get FIFA 2026 overview and available seasons',
        usage: '.fifastandings',
        async execute(sock, msg, args, extra) {
            await react(sock, msg, '⏳');
            try {
                const result = await keithApi('/fifastandings');
                await sendLong(sock, msg, `┏━━『 🏆 FIFA 2026 Standings 』━━`, fmtFifaStandings(result));
                await react(sock, msg, '✅');
            } catch (err) {
                await react(sock, msg, '❌');
                extra.reply(`❌ Failed: ${err.message}`);
            }
        },
    },

    // ── 6. FIFA World Cup — Full Group Stage ───────────────────────────────────
    {
        name: 'worldcupgroups',
        aliases: ['wcgroups', 'fifagroups', 'wcstage', 'groupstage'],
        category: 'sports',
        description: 'FIFA World Cup 2026 — full group stage table from Group A to last group',
        usage: '.worldcupgroups',
        async execute(sock, msg, args, extra) {
            await react(sock, msg, '⏳');
            try {
                // Fetch both endpoints and merge for best group coverage
                const [standings, fifa] = await Promise.allSettled([
                    keithApi('/fifa/standings'),
                    keithApi('/fifastandings'),
                ]);

                // Prefer /fifa/standings — richer group data, fall back to /fifastandings
                const result = standings.status === 'fulfilled'
                    ? standings.value
                    : fifa.status === 'fulfilled'
                        ? fifa.value
                        : null;

                if (!result) throw new Error('Both endpoints failed');

                const body = fmtWorldCupGroups(result);

                // Count how many groups we found for the footer
                let groupCount = 0;
                if (Array.isArray(result?.groups)) groupCount = result.groups.length;
                else if (Array.isArray(result?.standings)) {
                    const keys = new Set(result.standings.map(r => r.group).filter(Boolean));
                    groupCount = keys.size;
                }

                const footer =
                    `┗━━━━━━━━━━━━━━━━\n` +
                    `📋 Total Groups: *${groupCount || '?'}*\n` +
                    `✅ = Advance to Round of 32`;

                await sendLong(
                    sock, msg,
                    `┏━━『 🌍 FIFA World Cup 2026 — Group Stage 』━━`,
                    body,
                    footer
                );
                await react(sock, msg, '✅');

            } catch (err) {
                console.error('[worldcupgroups]', err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ Failed to fetch World Cup groups: ${err.message}`);
            }
        },
    },

    // ── 7. Live Score ──────────────────────────────────────────────────────────
    {
        name: 'livescore',
        aliases: ['live', 'liveresults'],
        category: 'sports',
        description: 'Get current football live scores',
        usage: '.livescore',
        async execute(sock, msg, args, extra) {
            await react(sock, msg, '⏳');
            try {
                const result = await keithApi('/livescore');
                await sendLong(sock, msg, `┏━━『 🔴 LIVE SCORES 』━━`, fmtLivescore(result));
                await react(sock, msg, '✅');
            } catch (err) {
                await react(sock, msg, '❌');
                extra.reply(`❌ Failed: ${err.message}`);
            }
        },
    },

    // ── 8. Live Score with Highlights ─────────────────────────────────────────
    {
        name: 'livehighlights',
        aliases: ['livescore2', 'livehl'],
        category: 'sports',
        description: 'Get live scores with highlight stream links',
        usage: '.livehighlights',
        async execute(sock, msg, args, extra) {
            await react(sock, msg, '⏳');
            try {
                const result = await keithApi('/livescore2');
                await sendLong(sock, msg, `┏━━『 🔴 LIVE SCORES + HIGHLIGHTS 』━━`, fmtLivescore2(result));
                await react(sock, msg, '✅');
            } catch (err) {
                await react(sock, msg, '❌');
                extra.reply(`❌ Failed: ${err.message}`);
            }
        },
    },

    // ── 9. Premier League ──────────────────────────────────────────────────────
    {
        name: 'epl',
        aliases: ['premierleague', 'pl'],
        category: 'sports',
        description: 'EPL — upcoming, matches, standings, scorers',
        usage: '.epl <upcoming|matches|standings|scorers>',
        async execute(sock, msg, args, extra) {
            await leagueHandler(sock, msg, args, extra, '⚽ Premier League', {
                upcoming:  { endpoint: '/epl/upcomingmatches', format: fmtMatches,   title: 'Upcoming Matches' },
                matches:   { endpoint: '/epl/matches',         format: fmtMatches,   title: 'Matches'          },
                standings: { endpoint: '/epl/standings',       format: fmtStandings, title: 'Standings'        },
                scorers:   { endpoint: '/epl/scorers',         format: fmtScorers,   title: 'Top Scorers'      },
            });
        },
    },

    // ── 10. Bundesliga ─────────────────────────────────────────────────────────
    {
        name: 'bundesliga',
        aliases: ['bund', 'germansoccer'],
        category: 'sports',
        description: 'Bundesliga — upcoming, matches, standings, scorers',
        usage: '.bundesliga <upcoming|matches|standings|scorers>',
        async execute(sock, msg, args, extra) {
            await leagueHandler(sock, msg, args, extra, '🇩🇪 Bundesliga', {
                upcoming:  { endpoint: '/bundesliga/upcomingmatches', format: fmtMatches,   title: 'Upcoming Matches' },
                matches:   { endpoint: '/bundesliga/matches',         format: fmtMatches,   title: 'Matches'          },
                standings: { endpoint: '/bundesliga/standings',       format: fmtStandings, title: 'Standings'        },
                scorers:   { endpoint: '/bundesliga/scorers',         format: fmtScorers,   title: 'Top Scorers'      },
            });
        },
    },

    // ── 11. Euros ──────────────────────────────────────────────────────────────
    {
        name: 'euros',
        aliases: ['eurocup', 'euro'],
        category: 'sports',
        description: 'Euros — upcoming, matches, standings, scorers',
        usage: '.euros <upcoming|matches|standings|scorers>',
        async execute(sock, msg, args, extra) {
            await leagueHandler(sock, msg, args, extra, '🏆 Euros', {
                upcoming:  { endpoint: '/euros/upcomingmatches', format: fmtMatches,   title: 'Upcoming Matches' },
                matches:   { endpoint: '/euros/matches',         format: fmtMatches,   title: 'Matches'          },
                standings: { endpoint: '/euros/standings',       format: fmtStandings, title: 'Standings'        },
                scorers:   { endpoint: '/euros/scorers',         format: fmtScorers,   title: 'Top Scorers'      },
            });
        },
    },

    // ── 12. FIFA World Cup (sub-commands) ──────────────────────────────────────
    {
        name: 'fifa',
        aliases: ['worldcup', 'fifawc'],
        category: 'sports',
        description: 'FIFA World Cup — upcoming, matches, standings, scorers',
        usage: '.fifa <upcoming|matches|standings|scorers>',
        async execute(sock, msg, args, extra) {
            await leagueHandler(sock, msg, args, extra, '🌍 FIFA World Cup', {
                upcoming:  { endpoint: '/fifa/upcomingmatches', format: fmtMatches,   title: 'Upcoming Matches' },
                matches:   { endpoint: '/fifa/matches',         format: fmtMatches,   title: 'Matches'          },
                standings: { endpoint: '/fifa/standings',       format: fmtStandings, title: 'Standings'        },
                scorers:   { endpoint: '/fifa/scorers',         format: fmtScorers,   title: 'Top Scorers'      },
            });
        },
    },

    // ── 13. La Liga ────────────────────────────────────────────────────────────
    {
        name: 'laliga',
        aliases: ['ll', 'spanishleague'],
        category: 'sports',
        description: 'La Liga — upcoming, matches, standings, scorers',
        usage: '.laliga <upcoming|matches|standings|scorers>',
        async execute(sock, msg, args, extra) {
            await leagueHandler(sock, msg, args, extra, '🇪🇸 La Liga', {
                upcoming:  { endpoint: '/laliga/upcomingmatches', format: fmtMatches,   title: 'Upcoming Matches' },
                matches:   { endpoint: '/laliga/matches',         format: fmtMatches,   title: 'Matches'          },
                standings: { endpoint: '/laliga/standings',       format: fmtStandings, title: 'Standings'        },
                scorers:   { endpoint: '/laliga/scorers',         format: fmtScorers,   title: 'Top Scorers'      },
            });
        },
    },

    // ── 14. Ligue 1 ────────────────────────────────────────────────────────────
    {
        name: 'ligue1',
        aliases: ['ligue', 'frenchleague'],
        category: 'sports',
        description: 'Ligue 1 — upcoming, matches, standings, scorers',
        usage: '.ligue1 <upcoming|matches|standings|scorers>',
        async execute(sock, msg, args, extra) {
            await leagueHandler(sock, msg, args, extra, '🇫🇷 Ligue 1', {
                upcoming:  { endpoint: '/ligue1/upcomingmatches', format: fmtMatches,   title: 'Upcoming Matches' },
                matches:   { endpoint: '/ligue1/matches',         format: fmtMatches,   title: 'Matches'          },
                standings: { endpoint: '/ligue1/standings',       format: fmtStandings, title: 'Standings'        },
                scorers:   { endpoint: '/ligue1/scorers',         format: fmtScorers,   title: 'Top Scorers'      },
            });
        },
    },

    // ── 15. Serie A ────────────────────────────────────────────────────────────
    {
        name: 'seriea',
        aliases: ['seria', 'italianleague'],
        category: 'sports',
        description: 'Serie A — upcoming, matches, standings, scorers',
        usage: '.seriea <upcoming|matches|standings|scorers>',
        async execute(sock, msg, args, extra) {
            await leagueHandler(sock, msg, args, extra, '🇮🇹 Serie A', {
                upcoming:  { endpoint: '/seriea/upcomingmatches', format: fmtMatches,   title: 'Upcoming Matches' },
                matches:   { endpoint: '/seriea/matches',         format: fmtMatches,   title: 'Matches'          },
                standings: { endpoint: '/seriea/standings',       format: fmtStandings, title: 'Standings'        },
                scorers:   { endpoint: '/seriea/scorers',         format: fmtScorers,   title: 'Top Scorers'      },
            });
        },
    },

    // ── 16. UCL Champions League ───────────────────────────────────────────────
    {
        name: 'ucl',
        aliases: ['championsleague', 'cl'],
        category: 'sports',
        description: 'UCL Champions League — upcoming, matches, standings, scorers',
        usage: '.ucl <upcoming|matches|standings|scorers>',
        async execute(sock, msg, args, extra) {
            await leagueHandler(sock, msg, args, extra, '🏆 UCL Champions League', {
                upcoming:  { endpoint: '/ucl/upcomingmatches', format: fmtMatches,   title: 'Upcoming Matches' },
                matches:   { endpoint: '/ucl/matches',         format: fmtMatches,   title: 'Matches'          },
                standings: { endpoint: '/ucl/standings',       format: fmtStandings, title: 'Standings'        },
                scorers:   { endpoint: '/ucl/scorers',         format: fmtScorers,   title: 'Top Scorers'      },
            });
        },
    },

    // ── 17. Sure Bet Tips ──────────────────────────────────────────────────────
    {
        name: 'bet',
        aliases: ['surebets', 'bettips', 'betodds'],
        category: 'sports',
        description: 'Get sure bet tips and free odds',
        usage: '.bet',
        async execute(sock, msg, args, extra) {
            await react(sock, msg, '⏳');
            try {
                const result = await keithApi('/bet');
                await sendLong(sock, msg, `┏━━『 🎰 Sure Bet Tips & Free Odds 』━━`, fmtBet(result));
                await react(sock, msg, '✅');
            } catch (err) {
                await react(sock, msg, '❌');
                extra.reply(`❌ Failed: ${err.message}`);
            }
        },
    },

    // ── 18. Football News ──────────────────────────────────────────────────────
    {
        name: 'footballnews',
        aliases: ['fnews', 'sportnews'],
        category: 'sports',
        description: 'Get latest football news',
        usage: '.footballnews',
        async execute(sock, msg, args, extra) {
            await react(sock, msg, '⏳');
            try {
                const result = await keithApi('/football/news');
                await sendLong(sock, msg, `┏━━『 📰 Football News 』━━`, fmtNews(result));
                await react(sock, msg, '✅');
            } catch (err) {
                await react(sock, msg, '❌');
                extra.reply(`❌ Failed: ${err.message}`);
            }
        },
    },

];
