/**
 * Sport Commands — Powered by Keith API (ravenn.site/sports)
 * Covers all endpoints including FIFA World Cup auto-updating group stage
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

// ── FIFA Auto-Update Engine ────────────────────────────────────────────────────
// Polls /fifa/standings every 3 minutes and caches result in memory.
// Automatically detects tournament phase (groups → knockouts → final → ended).

const fifaCache = {
    data:        null,   // last successful result
    phase:       'idle', // idle | groups | r32 | r16 | qf | sf | final | ended
    lastFetch:   0,
    fetchCount:  0,
    error:       null,
    interval:    null,
};

const POLL_INTERVAL = 3 * 60 * 1000; // 3 minutes

function detectPhase(result) {
    if (!result) return 'idle';
    const standings = result.standings || [];
    const matches   = result.matches   || result.upcomingMatches || [];
    const comp      = (result.competition || '').toLowerCase();

    if (comp.includes('final') && !comp.includes('semi') && !comp.includes('quarter'))
        return 'final';
    if (comp.includes('semi')) return 'sf';
    if (comp.includes('quarter')) return 'qf';
    if (comp.includes('round of 16')) return 'r16';
    if (comp.includes('round of 32')) return 'r32';

    // If standings still have 4-team groups → group stage
    if (standings.length > 0 && standings.length % 4 === 0) return 'groups';

    // If no standings but matches remain → knockout
    if (!standings.length && matches.length) return 'r32';

    // If we got a winner field → ended
    if (result.winner || result.champion) return 'ended';

    return 'groups';
}

async function fetchFifaData() {
    try {
        const result = await keithApi('/fifa/standings');
        fifaCache.data      = result;
        fifaCache.phase     = detectPhase(result);
        fifaCache.lastFetch = Date.now();
        fifaCache.fetchCount++;
        fifaCache.error     = null;

        // Stop polling if tournament is over
        if (fifaCache.phase === 'ended') {
            stopFifaPolling();
            console.log('[FIFA] Tournament ended — polling stopped.');
        }

        console.log(`[FIFA] Auto-update #${fifaCache.fetchCount} — phase: ${fifaCache.phase}`);
    } catch (err) {
        fifaCache.error = err.message;
        console.error('[FIFA] Auto-update failed:', err.message);
    }
}

function startFifaPolling() {
    if (fifaCache.interval) return; // already running
    fetchFifaData(); // immediate first fetch
    fifaCache.interval = setInterval(fetchFifaData, POLL_INTERVAL);
    console.log('[FIFA] Auto-update polling started (every 3 min)');
}

function stopFifaPolling() {
    if (fifaCache.interval) {
        clearInterval(fifaCache.interval);
        fifaCache.interval = null;
    }
}

// Start polling immediately when module loads
startFifaPolling();

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
        'serbia': '🇷🇸', 'south africa': '🇿🇦', 'south korea': '🇰🇷', 'spain': '🇪🇸',
        'switzerland': '🇨🇭', 'tunisia': '🇹🇳', 'turkey': '🇹🇷', 'ukraine': '🇺🇦',
        'united states': '🇺🇸', 'usa': '🇺🇸', 'uruguay': '🇺🇾', 'wales': '🏴󠁧󠁢󠁷󠁬󠁳󠁿',
        'czechia': '🇨🇿', 'czech republic': '🇨🇿', 'new zealand': '🇳🇿',
        'ivory coast': '🇨🇮', 'venezuela': '🇻🇪', 'panama': '🇵🇦', 'bolivia': '🇧🇴',
        'honduras': '🇭🇳', 'jamaica': '🇯🇲', 'indonesia': '🇮🇩', 'thailand': '🇹🇭',
    };
    for (const [country, flag] of Object.entries(flags)) {
        if (n.includes(country)) return flag;
    }
    return '🏳️';
}

// ── Phase label helper ────────────────────────────────────────────────────────

function phaseLabel(phase) {
    const labels = {
        idle:   '⏳ Awaiting tournament start',
        groups: '🔷 Group Stage',
        r32:    '⚔️ Round of 32',
        r16:    '⚔️ Round of 16',
        qf:     '🏅 Quarter Finals',
        sf:     '🏅 Semi Finals',
        final:  '🏆 FINAL',
        ended:  '🎉 Tournament Ended',
    };
    return labels[phase] || phase;
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
            s += `   📝 ${String(t.description).slice(0, 200).trim()}...\n`;
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
            s += `   📝 ${String(v.description).slice(0, 200).trim()}...\n`;
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
        const pos  = String(r.position || '').padStart(2);
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
        if (status)     s += `┃ 🔴 ${status}\n`;
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

// ── FIFA formatter — reads exact API shape: { competition, standings: [...] } ──

function fmtFifaStandings(result) {
    if (!result) return '_No FIFA data available_';

    const standings = result.standings || [];
    const comp      = result.competition || 'FIFA World Cup';

    if (!standings.length) return `🌍 *${comp}*\n\n_No standings data yet._`;

    let body = `🌍 *${comp}*\n\n`;
    body += `${'─'.repeat(44)}\n`;
    body += ` # ${'Team'.padEnd(20)} MP  W  D  L  GF GA  GD Pts\n`;
    body += `${'─'.repeat(44)}\n`;

    for (const t of standings) {
        const pos  = String(t.position || '').padStart(2);
        const name = (t.team || '?').slice(0, 18).padEnd(20);
        const mp   = String(t.played         ?? 0).padStart(2);
        const w    = String(t.won            ?? 0).padStart(2);
        const d    = String(t.draw           ?? 0).padStart(2);
        const l    = String(t.lost           ?? 0).padStart(2);
        const gf   = String(t.goalsFor       ?? 0).padStart(3);
        const ga   = String(t.goalsAgainst   ?? 0).padStart(3);
        const gd   = String(t.goalDifference ?? 0).padStart(4);
        const pts  = String(t.points         ?? 0).padStart(3);
        const flag = countryFlag(t.team || '');

        body += `${pos}. ${flag} ${name}${mp} ${w} ${d} ${l} ${gf}${ga} ${gd}${pts}\n`;
    }

    return body;
}

// ── FIFA group stage formatter — chunks flat standings into groups of 4 ────────

function fmtWorldCupGroups(result) {
    const standings = result?.standings || (Array.isArray(result) ? result : []);
    const comp      = result?.competition || 'FIFA World Cup';

    if (!standings.length) {
        return `🌍 *${comp}*\n\n_Group stage data not yet available._`;
    }

    // Check if API provides a group field
    const hasGroupField = standings.some(r => r.group);

    let groupMap = {};

    if (hasGroupField) {
        for (const row of standings) {
            const g = (row.group || '').replace(/Group\s*/i, '').trim();
            if (!g) continue;
            if (!groupMap[g]) groupMap[g] = [];
            groupMap[g].push(row);
        }
    } else {
        // No group field — chunk every 4 rows: A, B, C, D ...
        const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        standings.forEach((row, idx) => {
            const letter = letters[Math.floor(idx / 4)] || `G${Math.floor(idx / 4) + 1}`;
            if (!groupMap[letter]) groupMap[letter] = [];
            groupMap[letter].push(row);
        });
    }

    const groupKeys = Object.keys(groupMap).sort();
    let body = '';

    for (const key of groupKeys) {
        const teams = groupMap[key];

        body += `🔷 *GROUP ${key}*\n`;
        body += `${'─'.repeat(46)}\n`;
        body += `  ${'Team'.padEnd(22)} MP  W  D  L  GF GA  GD Pts\n`;

        teams.forEach((t, idx) => {
            const name = (t.team || '?').slice(0, 20).padEnd(22);
            const mp   = String(t.played         ?? 0).padStart(2);
            const w    = String(t.won            ?? 0).padStart(2);
            const d    = String(t.draw           ?? 0).padStart(2);
            const l    = String(t.lost           ?? 0).padStart(2);
            const gf   = String(t.goalsFor       ?? 0).padStart(3);
            const ga   = String(t.goalsAgainst   ?? 0).padStart(3);
            const gd   = String(t.goalDifference ?? 0).padStart(4);
            const pts  = String(t.points         ?? 0).padStart(3);
            const flag = countryFlag(t.team || '');
            const mark = idx < 2 ? '✅' : '  '; // top 2 advance

            body += `${mark}${flag} ${name}${mp} ${w} ${d} ${l} ${gf}${ga} ${gd}${pts}\n`;
        });

        body += '\n';
    }

    return body;
}

// ── Knockout stage formatter ───────────────────────────────────────────────────

function fmtKnockout(result, phase) {
    const matches = result?.matches || result?.fixtures ||
                    result?.upcomingMatches || (Array.isArray(result) ? result : []);

    if (!matches.length) return `_No ${phaseLabel(phase)} data available yet._`;

    return matches.slice(0, 32).map((m, i) => {
        const home   = m.homeTeam || m.home || m.team1 || '?';
        const away   = m.awayTeam || m.away || m.team2 || '?';
        const score  = m.score || (m.homeScore !== undefined ? `${m.homeScore} - ${m.awayScore}` : null);
        const date   = m.date || m.utcDate || '';
        const venue  = m.venue || m.stadium || '';
        const status = m.status || '';
        const hFlag  = countryFlag(home);
        const aFlag  = countryFlag(away);

        let s = `┏ *Match ${i + 1}*\n`;
        s += `┃ ${hFlag} *${home}* vs *${away}* ${aFlag}\n`;
        if (score)  s += `┃ 📊 Score: *${score}*\n`;
        if (date)   s += `┃ 📅 ${date}\n`;
        if (venue)  s += `┃ 🏟️ ${venue}\n`;
        if (status) s += `┃ 🔄 ${status}\n`;
        s += `┗━━━━━━━━━━━━━━━\n`;
        return s;
    }).join('\n');
}

// ── Final formatter ────────────────────────────────────────────────────────────

function fmtFinal(result) {
    const match = (result?.matches || result?.fixtures || [])[0] || result;

    if (!match) return '_Final data not available yet._';

    const home   = match.homeTeam || match.home || match.team1 || '?';
    const away   = match.awayTeam || match.away || match.team2 || '?';
    const score  = match.score || (match.homeScore !== undefined ? `${match.homeScore} - ${match.awayScore}` : null);
    const date   = match.date || match.utcDate || '';
    const venue  = match.venue || match.stadium || '';
    const winner = result.winner || result.champion || match.winner || '';
    const hFlag  = countryFlag(home);
    const aFlag  = countryFlag(away);
    const wFlag  = winner ? countryFlag(winner) : '';

    let body = `🏆 *THE FINAL*\n`;
    body += `${'═'.repeat(30)}\n\n`;
    body += `${hFlag} *${home}*\n`;
    body += `         ⚔️  VS  ⚔️\n`;
    body += `${aFlag} *${away}*\n\n`;
    if (score)  body += `📊 *Score: ${score}*\n`;
    if (date)   body += `📅 Date: ${date}\n`;
    if (venue)  body += `🏟️ Venue: ${venue}\n`;
    if (winner) body += `\n🥇 *CHAMPION: ${wFlag} ${winner}* 🎉\n`;

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

    // ── 5. FIFA — Auto-updating full tournament tracker ────────────────────────
    {
        name: 'worldcupgroups',
        aliases: ['wcgroups', 'fifagroups', 'wcstage', 'groupstage', 'wc', 'fifatracker'],
        category: 'sports',
        description: 'FIFA World Cup 2026 — live auto-updating tracker (groups → knockouts → final)',
        usage: '.worldcupgroups',
        async execute(sock, msg, args, extra) {
            await react(sock, msg, '⏳');
            try {
                // Use cached data if fresh (< 3 min), else force a fresh fetch
                const now     = Date.now();
                const isFresh = fifaCache.data && (now - fifaCache.lastFetch < POLL_INTERVAL);

                if (!isFresh) await fetchFifaData();

                const result = fifaCache.data;
                const phase  = fifaCache.phase;
                const lastUp = fifaCache.lastFetch
                    ? new Date(fifaCache.lastFetch).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
                    : 'unknown';

                if (!result) {
                    await react(sock, msg, '❌');
                    return extra.reply(`❌ FIFA data unavailable: ${fifaCache.error || 'unknown error'}`);
                }

                const comp = result.competition || 'FIFA World Cup 2026';

                // ── Build output per phase ─────────────────────────────────────
                let body   = '';
                let header = '';
                let footer = '';

                if (phase === 'groups') {
                    const standings = result.standings || [];
                    const groups    = Math.ceil(standings.length / 4);
                    header = `┏━━『 🌍 ${comp} — Group Stage 』━━`;
                    body   = fmtWorldCupGroups(result);
                    footer =
                        `┗━━━━━━━━━━━━━━━━\n` +
                        `📋 Groups: *${groups}*  •  Teams: *${standings.length}*\n` +
                        `✅ = Top 2 advance to Round of 32\n` +
                        `🔄 Last updated: *${lastUp}* (auto-updates every 3 min)`;

                } else if (phase === 'r32' || phase === 'r16') {
                    const label = phase === 'r32' ? 'Round of 32' : 'Round of 16';
                    header = `┏━━『 🌍 ${comp} — ${label} 』━━`;
                    body   = fmtKnockout(result, phase);
                    footer =
                        `┗━━━━━━━━━━━━━━━━\n` +
                        `⚔️ *${label}*\n` +
                        `🔄 Last updated: *${lastUp}* (auto-updates every 3 min)`;

                } else if (phase === 'qf') {
                    header = `┏━━『 🌍 ${comp} — Quarter Finals 』━━`;
                    body   = fmtKnockout(result, phase);
                    footer =
                        `┗━━━━━━━━━━━━━━━━\n` +
                        `🏅 *Quarter Finals*\n` +
                        `🔄 Last updated: *${lastUp}* (auto-updates every 3 min)`;

                } else if (phase === 'sf') {
                    header = `┏━━『 🌍 ${comp} — Semi Finals 』━━`;
                    body   = fmtKnockout(result, phase);
                    footer =
                        `┗━━━━━━━━━━━━━━━━\n` +
                        `🏅 *Semi Finals*\n` +
                        `🔄 Last updated: *${lastUp}* (auto-updates every 3 min)`;

                } else if (phase === 'final') {
                    header = `┏━━『 🏆 ${comp} — THE FINAL 』━━`;
                    body   = fmtFinal(result);
                    footer =
                        `┗━━━━━━━━━━━━━━━━\n` +
                        `🔄 Last updated: *${lastUp}* (auto-updates every 3 min)`;

                } else if (phase === 'ended') {
                    header = `┏━━『 🏆 ${comp} — TOURNAMENT OVER 』━━`;
                    body   = fmtFinal(result);
                    footer =
                        `┗━━━━━━━━━━━━━━━━\n` +
                        `🎉 FIFA World Cup 2026 has concluded!\n` +
                        `Auto-updates have stopped.`;

                } else {
                    // idle / unknown — show raw standings if any
                    header = `┏━━『 🌍 ${comp} 』━━`;
                    body   = fmtFifaStandings(result);
                    footer =
                        `┗━━━━━━━━━━━━━━━━\n` +
                        `🔄 Last updated: *${lastUp}*`;
                }

                await sendLong(sock, msg, header, body, footer);
                await react(sock, msg, '✅');

            } catch (err) {
                console.error('[worldcupgroups]', err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ Failed to fetch FIFA data: ${err.message}`);
            }
        },
    },

    // ── 6. FIFA standings overview ────────────────────────────────────────────
    {
        name: 'fifastandings',
        aliases: ['fifa2026', 'worldcup2026'],
        category: 'sports',
        description: 'FIFA World Cup 2026 — full standings table',
        usage: '.fifastandings',
        async execute(sock, msg, args, extra) {
            await react(sock, msg, '⏳');
            try {
                const isFresh = fifaCache.data && (Date.now() - fifaCache.lastFetch < POLL_INTERVAL);
                if (!isFresh) await fetchFifaData();

                const result = fifaCache.data;
                if (!result) {
                    await react(sock, msg, '❌');
                    return extra.reply(`❌ FIFA data unavailable: ${fifaCache.error || 'unknown error'}`);
                }

                const lastUp = new Date(fifaCache.lastFetch).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                const body   = fmtFifaStandings(result);

                await sendLong(
                    sock, msg,
                    `┏━━『 🏆 FIFA World Cup 2026 — Standings 』━━`,
                    body,
                    `┗━━━━━━━━━━━━━━━━\n🔄 Last updated: *${lastUp}* (auto-updates every 3 min)`
                );
                await react(sock, msg, '✅');
            } catch (err) {
                await react(sock, msg, '❌');
                extra.reply(`❌ Failed: ${err.message}`);
            }
        },
    },

    // ── 7. FIFA sub-commands (matches / upcoming / scorers) ───────────────────
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
                standings: { endpoint: '/fifa/standings',       format: fmtFifaStandings, title: 'Standings'    },
                scorers:   { endpoint: '/fifa/scorers',         format: fmtScorers,   title: 'Top Scorers'      },
            });
        },
    },

    // ── 8. Live Score ─────────────────────────────────────────────────────────
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

    // ── 9. Live Score with Highlights ────────────────────────────────────────
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

    // ── 10. Premier League ───────────────────────────────────────────────────
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

    // ── 11. Bundesliga ───────────────────────────────────────────────────────
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

    // ── 12. Euros ────────────────────────────────────────────────────────────
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

    // ── 13. La Liga ──────────────────────────────────────────────────────────
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

    // ── 14. Ligue 1 ──────────────────────────────────────────────────────────
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

    // ── 15. Serie A ──────────────────────────────────────────────────────────
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

    // ── 16. UCL Champions League ─────────────────────────────────────────────
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

    // ── 17. Sure Bet Tips ────────────────────────────────────────────────────
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

    // ── 18. Football News ────────────────────────────────────────────────────
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
