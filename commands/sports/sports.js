/**
 * Sports Commands — Powered by TheSportsDB
 */

const axios = require('axios');
const { applyFont } = require('../../utils/fontConverter');

const BASE = 'https://www.thesportsdb.com/api/v1/json/3';

const LEAGUES = {
    epl:  { id: '4328', label: '⚽ Premier League'    },
    nba:  { id: '4387', label: '🏀 NBA'               },
    nfl:  { id: '4391', label: '🏈 NFL'               },
    mlb:  { id: '4424', label: '⚾ MLB'               },
    nhl:  { id: '4380', label: '🏒 NHL'               },
    ll:   { id: '4335', label: '⚽ La Liga'           },
    ucl:  { id: '4480', label: '🏆 Champions League'  },
    mls:  { id: '4346', label: '⚽ MLS'               },
    sera: { id: '4332', label: '⚽ Serie A'           },
    bund: { id: '4331', label: '⚽ Bundesliga'        },
};

const VALID_LEAGUES   = Object.keys(LEAGUES).join(' | ');
const MAX_MSG_LENGTH  = 3500;

const SPORT_EMOJI = {
    Soccer: '⚽', Football: '🏈', Basketball: '🏀', Baseball: '⚾', Tennis: '🎾',
    Cricket: '🏏', Rugby: '🏉', Golf: '⛳', Boxing: '🥊', 'Ice Hockey': '🏒',
    Volleyball: '🏐', Motorsport: '🏎️', Cycling: '🚴', Athletics: '🏃', Swimming: '🏊',
    Darts: '🎯', Snooker: '🎱', MMA: '🥋', Handball: '🤾', Badminton: '🏸',
    'American Football': '🏈', Wrestling: '🤼', default: '🏅',
};

// ── Shared helpers ─────────────────────────────────────────────────────────────

const react = (sock, msg, emoji) =>
    sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } });

const send = (sock, msg, text) =>
    sock.sendMessage(msg.key.remoteJid, { text }, { quoted: msg });

const sendImage = (sock, msg, url, caption) =>
    sock.sendMessage(msg.key.remoteJid, { image: { url }, caption }, { quoted: msg });

async function sportsDB(endpoint, params = {}) {
    const qs = new URLSearchParams(params).toString();
    const { data } = await axios.get(`${BASE}/${endpoint}${qs ? '?' + qs : ''}`, { timeout: 15000 });
    return data;
}

function formatDateTime(e) {
    try {
        if (e.strTimestamp) return new Date(e.strTimestamp).toUTCString().replace(' GMT', ' UTC');
        if (e.dateEvent && e.strTime) return `${e.dateEvent} ${e.strTime} UTC`;
        if (e.dateEvent) return e.dateEvent;
    } catch (_) {}
    return 'Unknown';
}

function formatScore(e) {
    const h = e.intHomeScore, a = e.intAwayScore;
    return (h !== null && h !== undefined && h !== '' && a !== null && a !== undefined && a !== '')
        ? `${h} - ${a}` : 'TBD';
}

function formatEvent(e) {
    const home = e.strHomeTeam || '???', away = e.strAwayTeam || '???';
    const date = e.dateEvent || '', time = e.strTime ? e.strTime.slice(0, 5) : '';
    const hasScore = e.intHomeScore !== null && e.intHomeScore !== undefined && e.intHomeScore !== '';
    if (hasScore) return `${away} ${e.intAwayScore} - ${e.intHomeScore} ${home}  ✅ ${date}`;
    return `${away} vs ${home}  🕐 ${date} ${time}`;
}

async function sendChunked(sock, chatId, msg, header, lines, footer) {
    const chunks = [];
    let current = '';
    for (const line of lines) {
        if ((current + line + '\n').length > MAX_MSG_LENGTH) { chunks.push(current); current = ''; }
        current += line + '\n';
    }
    if (current) chunks.push(current);
    for (let i = 0; i < chunks.length; i++) {
        const part = chunks.length > 1 ? ` (${i + 1}/${chunks.length})` : '';
        const text = applyFont(
            (i === 0 ? `${header}${part}\n\n` : `${header}${part} cont...\n\n`) +
            chunks[i] + (i === chunks.length - 1 ? `\n${footer}` : '')
        );
        await sock.sendMessage(chatId, { text }, { quoted: i === 0 ? msg : undefined });
    }
}

// ── Commands ───────────────────────────────────────────────────────────────────

module.exports = [

    // ── SPORTS (original command) ──────────────────────────────────────────────

    {
        name: 'sports',
        aliases: ['score', 'scores'],
        category: 'sports',
        description: 'Results, upcoming fixtures & standings for major leagues',
        usage: '.sports <league>',

        async execute(sock, msg, args, extra) {
            try {
                const leagueKey = args[0]?.toLowerCase();
                const filter    = args[1]?.toLowerCase();
                const chatId    = extra.from;

                const FILTERS = ['results', 'upcoming', 'fixtures', 'standings'];

                if (!leagueKey) {
                    return extra.reply(applyFont(
                        `┏━━『 SPORTS COMMAND 』━━\n\n` +
                        `Usage: .sports <league> [filter]\n\n` +
                        `Available leagues:\n` +
                        `  ⚽ epl   — Premier League\n` +
                        `  🏀 nba   — NBA Basketball\n` +
                        `  🏈 nfl   — NFL Football\n` +
                        `  ⚾ mlb   — MLB Baseball\n` +
                        `  🏒 nhl   — NHL Hockey\n` +
                        `  ⚽ ll    — La Liga\n` +
                        `  🏆 ucl   — Champions League\n` +
                        `  ⚽ mls   — MLS\n` +
                        `  ⚽ sera  — Serie A\n` +
                        `  ⚽ bund  — Bundesliga\n\n` +
                        `Optional filters:\n` +
                        `  results | upcoming | standings\n\n` +
                        `Examples:\n` +
                        `  .sports epl\n` +
                        `  .sports epl standings\n` +
                        `  .sports nba results\n` +
                        `  .sports ucl upcoming\n\n` +
                        `┗━━━━━━━━━━━━━━━━`
                    ));
                }

                const leagueInfo = LEAGUES[leagueKey];
                if (!leagueInfo) return extra.reply(`❌ Unknown league *${leagueKey}*\n\nAvailable: ${VALID_LEAGUES}`);

                if (filter && !FILTERS.includes(filter)) {
                    return extra.reply(`❌ Unknown filter *${filter}*\n\nValid filters: results | upcoming | standings`);
                }

                await react(sock, msg, '⏳');
                const { id, label } = leagueInfo;

                const showResults   = !filter || filter === 'results';
                const showUpcoming  = !filter || filter === 'upcoming' || filter === 'fixtures';
                const showStandings = !filter || filter === 'standings';

                const [pastRaw, nextRaw, standRaw] = await Promise.all([
                    showResults   ? sportsDB(`eventspastleague.php?id=${id}`)  : Promise.resolve({}),
                    showUpcoming  ? sportsDB(`eventsnextleague.php?id=${id}`)  : Promise.resolve({}),
                    showStandings ? sportsDB(`lookuptable.php?l=${id}`)         : Promise.resolve({}),
                ]);

                // ── Results ───────────────────────────────────────────────────
                if (showResults) {
                    const pastEvents = (pastRaw.events || []).reverse();
                    if (pastEvents.length) {
                        await sendChunked(
                            sock, chatId, msg,
                            `┏━━『 ${label} RESULTS (${pastEvents.length} games) 』━━`,
                            pastEvents.map(formatEvent),
                            `┗━━━━━━━━━━━━━━━━`
                        );
                    } else {
                        await sock.sendMessage(chatId, { text: applyFont(`┏━━『 ${label} RESULTS 』━━\n\n❌ No recent results found.\n\n┗━━━━━━━━━━━━━━━━`) }, { quoted: msg });
                    }
                }

                // ── Upcoming Fixtures ─────────────────────────────────────────
                if (showUpcoming) {
                    const nextEvents = nextRaw.events || [];
                    if (nextEvents.length) {
                        await sendChunked(
                            sock, chatId, msg,
                            `┏━━『 ${label} UPCOMING (${nextEvents.length} games) 』━━`,
                            nextEvents.map(formatEvent),
                            `┗━━━━━━━━━━━━━━━━`
                        );
                    } else {
                        await sock.sendMessage(chatId, { text: applyFont(`┏━━『 ${label} UPCOMING 』━━\n\n❌ No upcoming fixtures found.\n\n┗━━━━━━━━━━━━━━━━`) }, { quoted: msg });
                    }
                }

                // ── Standings ─────────────────────────────────────────────────
                if (showStandings) {
                    const table = standRaw.table || [];
                    if (table.length) {
                        const standLines = table.map(row => {
                            const pos  = String(row.intRank || '').padStart(2);
                            const team = (row.strTeam || '???').padEnd(22);
                            const p = row.intPlayed || 0, w = row.intWin || 0;
                            const d = row.intDraw  || 0, l = row.intLoss || 0;
                            const pts = row.intPoints || 0;
                            return `${pos}. ${team} P${p} W${w} D${d} L${l} | ${pts}pts`;
                        });
                        await sendChunked(
                            sock, chatId, msg,
                            `┏━━『 ${label} STANDINGS (${standLines.length} teams) 』━━`,
                            standLines,
                            `┗━━━━━━━━━━━━━━━━`
                        );
                    } else {
                        await sock.sendMessage(chatId, { text: applyFont(`┏━━『 ${label} STANDINGS 』━━\n\n❌ No standings available right now.\n\n┗━━━━━━━━━━━━━━━━`) }, { quoted: msg });
                    }
                }

                await react(sock, msg, '✅');

            } catch (err) {
                console.error('[sports]', err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ Failed to fetch sports data: ${err.message}`);
            }
        },
    },

    // ── TEAM ──────────────────────────────────────────────────────────────────

    {
        name: 'searchteam',
        aliases: ['findteam', 'teamlookup'],
        category: 'sports',
        description: 'Search for a sports team by name',
        usage: '.searchteam <team name>',

        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Provide a team name.\n\nExample: *.searchteam Arsenal*');

            await react(sock, msg, '🔍');
            try {
                const data = await sportsDB('searchteams.php', { t: query });
                const teams = data.teams;
                if (!teams || !teams.length) return send(sock, msg, `❌ No teams found for *"${query}"*`);

                let text = `🏟️ *Teams matching "${query}"*\n━━━━━━━━━━━━━━━\n\n`;
                teams.slice(0, 8).forEach((t, i) => {
                    text += `${i + 1}. *${t.strTeam}*\n`;
                    if (t.strSport)       text += `   🏅 Sport: ${t.strSport}\n`;
                    if (t.strLeague)      text += `   🏆 League: ${t.strLeague}\n`;
                    if (t.strCountry)     text += `   🌍 Country: ${t.strCountry}\n`;
                    if (t.intFormedYear)  text += `   📅 Founded: ${t.intFormedYear}\n`;
                    if (t.idTeam)         text += `   🆔 ID: ${t.idTeam}\n`;
                    text += '\n';
                });
                text += `💡 Use *.teaminfo <id or name>* for full details.`;
                await send(sock, msg, text.trim());
            } catch (err) {
                console.error('[searchteam]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Search failed. Please try again later.');
            }
        },
    },

    {
        name: 'teaminfo',
        aliases: ['team', 'teamdetails'],
        category: 'sports',
        description: 'Get full details about a team by ID or name',
        usage: '.teaminfo <team id or name>',

        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Provide a team ID or name.\n\nExample: *.teaminfo Arsenal*\nor *.teaminfo 133604*');

            await react(sock, msg, '⚽');
            try {
                let team;
                if (/^\d+$/.test(query)) {
                    const data = await sportsDB('lookupteam.php', { id: query });
                    team = data.teams && data.teams[0];
                } else {
                    const data = await sportsDB('searchteams.php', { t: query });
                    team = data.teams && data.teams[0];
                }
                if (!team) return send(sock, msg, `❌ Team *"${query}"* not found.`);

                let text = `🏟️ *${team.strTeam}*\n━━━━━━━━━━━━━━━\n\n`;
                if (team.strTeamAlternate)   text += `🔤 Also known as: ${team.strTeamAlternate}\n`;
                if (team.strSport)           text += `🏅 Sport: ${team.strSport}\n`;
                if (team.strLeague)          text += `🏆 League: ${team.strLeague}\n`;
                if (team.strCountry)         text += `🌍 Country: ${team.strCountry}\n`;
                if (team.strLocation)        text += `📍 Location: ${team.strLocation}\n`;
                if (team.intFormedYear)      text += `📅 Founded: ${team.intFormedYear}\n`;
                if (team.strStadium)         text += `🏟️ Stadium: ${team.strStadium}\n`;
                if (team.intStadiumCapacity) text += `👥 Capacity: ${parseInt(team.intStadiumCapacity).toLocaleString()}\n`;
                if (team.strGender)          text += `⚧ Gender: ${team.strGender}\n`;
                if (team.strKeywords)        text += `🔖 Keywords: ${team.strKeywords}\n`;
                if (team.strWebsite)         text += `🌐 Website: https://${team.strWebsite}\n`;
                if (team.strTwitter)         text += `🐦 Twitter: https://${team.strTwitter}\n`;
                if (team.strInstagram)       text += `📸 Instagram: https://${team.strInstagram}\n`;
                if (team.strFacebook)        text += `📘 Facebook: https://${team.strFacebook}\n`;
                if (team.idTeam)             text += `\n🆔 Team ID: ${team.idTeam}\n`;
                if (team.strDescriptionEN) {
                    const desc = team.strDescriptionEN.trim().slice(0, 300);
                    text += `\n📝 *About:*\n${desc}${team.strDescriptionEN.length > 300 ? '...' : ''}\n`;
                }

                if (team.strTeamBadge) {
                    await sendImage(sock, msg, team.strTeamBadge, text.trim());
                } else {
                    await send(sock, msg, text.trim());
                }
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[teaminfo]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Failed to get team info. Please try again later.');
            }
        },
    },

    {
        name: 'teamplayers',
        aliases: ['squad', 'roster'],
        category: 'sports',
        description: 'List all players in a team by team ID or name',
        usage: '.teamplayers <team id or name>',

        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Provide a team ID or name.\n\nExample: *.teamplayers Arsenal*\nor *.teamplayers 133604*');

            await react(sock, msg, '👥');
            try {
                let teamId = query;
                if (!/^\d+$/.test(query)) {
                    const search = await sportsDB('searchteams.php', { t: query });
                    const team = search.teams && search.teams[0];
                    if (!team) return send(sock, msg, `❌ Team *"${query}"* not found.`);
                    teamId = team.idTeam;
                }

                const data = await sportsDB('lookup_all_players.php', { id: teamId });
                const players = data.player;
                if (!players || !players.length) return send(sock, msg, `❌ No players found for this team.`);

                let text = `👥 *Squad — ${players[0].strTeam || 'Team'}*\n━━━━━━━━━━━━━━━\n\n`;
                const byPos = {};
                players.forEach(p => {
                    const pos = p.strPosition || 'Unknown';
                    if (!byPos[pos]) byPos[pos] = [];
                    byPos[pos].push(p);
                });
                for (const [pos, list] of Object.entries(byPos)) {
                    text += `*${pos}*\n`;
                    list.forEach(p => {
                        text += `  • ${p.strPlayer}`;
                        if (p.strNationality) text += ` (${p.strNationality})`;
                        if (p.strNumber)      text += ` #${p.strNumber}`;
                        text += '\n';
                    });
                    text += '\n';
                }
                text += `Total: ${players.length} players`;

                await send(sock, msg, text.trim());
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[teamplayers]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Failed to get squad. Please try again later.');
            }
        },
    },

    // ── PLAYER ────────────────────────────────────────────────────────────────

    {
        name: 'searchplayer',
        aliases: ['findplayer', 'playersearch'],
        category: 'sports',
        description: 'Search for a sports player by name',
        usage: '.searchplayer <player name>',

        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Provide a player name.\n\nExample: *.searchplayer Messi*');

            await react(sock, msg, '🔍');
            try {
                const data = await sportsDB('searchplayers.php', { p: query });
                const players = data.player;
                if (!players || !players.length) return send(sock, msg, `❌ No players found for *"${query}"*`);

                let text = `⚽ *Players matching "${query}"*\n━━━━━━━━━━━━━━━\n\n`;
                players.slice(0, 8).forEach((p, i) => {
                    text += `${i + 1}. *${p.strPlayer}*\n`;
                    if (p.strTeam)        text += `   🏟️ Team: ${p.strTeam}\n`;
                    if (p.strSport)       text += `   🏅 Sport: ${p.strSport}\n`;
                    if (p.strNationality) text += `   🌍 Nationality: ${p.strNationality}\n`;
                    if (p.strPosition)    text += `   📍 Position: ${p.strPosition}\n`;
                    if (p.dateBorn)       text += `   🎂 Born: ${p.dateBorn}\n`;
                    if (p.idPlayer)       text += `   🆔 ID: ${p.idPlayer}\n`;
                    text += '\n';
                });
                text += `💡 Use *.playerinfo <id or name>* for full details.`;
                await send(sock, msg, text.trim());
            } catch (err) {
                console.error('[searchplayer]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Search failed. Please try again later.');
            }
        },
    },

    {
        name: 'playerinfo',
        aliases: ['player', 'playerdetails'],
        category: 'sports',
        description: 'Get full profile of a player by ID or name',
        usage: '.playerinfo <player id or name>',

        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Provide a player ID or name.\n\nExample: *.playerinfo Messi*\nor *.playerinfo 34146370*');

            await react(sock, msg, '🏃');
            try {
                let player;
                if (/^\d+$/.test(query)) {
                    const data = await sportsDB('lookupplayer.php', { id: query });
                    player = data.players && data.players[0];
                } else {
                    const data = await sportsDB('searchplayers.php', { p: query });
                    player = data.player && data.player[0];
                }
                if (!player) return send(sock, msg, `❌ Player *"${query}"* not found.`);

                let text = `🏃 *${player.strPlayer}*\n━━━━━━━━━━━━━━━\n\n`;
                if (player.strPlayerAlternate) text += `🔤 Also: ${player.strPlayerAlternate}\n`;
                if (player.strSport)           text += `🏅 Sport: ${player.strSport}\n`;
                if (player.strTeam)            text += `🏟️ Team: ${player.strTeam}\n`;
                if (player.strTeam2)           text += `🏟️ International: ${player.strTeam2}\n`;
                if (player.strPosition)        text += `📍 Position: ${player.strPosition}\n`;
                if (player.strNationality)     text += `🌍 Nationality: ${player.strNationality}\n`;
                if (player.dateBorn) {
                    const age = Math.floor((Date.now() - new Date(player.dateBorn)) / (365.25 * 24 * 3600 * 1000));
                    text += `🎂 Born: ${player.dateBorn} (Age ${age})\n`;
                }
                if (player.strBirthLocation) text += `📍 Birthplace: ${player.strBirthLocation}\n`;
                if (player.strNumber)        text += `🔢 Jersey #: ${player.strNumber}\n`;
                if (player.strStatus)        text += `✅ Status: ${player.strStatus}\n`;
                if (player.strHeight)        text += `📏 Height: ${player.strHeight}\n`;
                if (player.strWeight)        text += `⚖️ Weight: ${player.strWeight}\n`;
                if (player.strSigning)       text += `💰 Signing: ${player.strSigning}\n`;
                if (player.strAgent)         text += `🤝 Agent: ${player.strAgent}\n`;
                if (player.idPlayer)         text += `\n🆔 Player ID: ${player.idPlayer}\n`;
                if (player.strDescriptionEN) {
                    const desc = player.strDescriptionEN.trim().slice(0, 350);
                    text += `\n📝 *Bio:*\n${desc}${player.strDescriptionEN.length > 350 ? '...' : ''}\n`;
                }

                const thumb = player.strThumb || player.strCutout;
                if (thumb) {
                    await sendImage(sock, msg, thumb, text.trim());
                } else {
                    await send(sock, msg, text.trim());
                }
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[playerinfo]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Failed to get player info. Please try again later.');
            }
        },
    },

    // ── LEAGUE ────────────────────────────────────────────────────────────────

    {
        name: 'searchleague',
        aliases: ['findleague', 'leaguesearch'],
        category: 'sports',
        description: 'Search for leagues by sport or country',
        usage: '.searchleague <sport> [country]',

        async execute(sock, msg, args, extra) {
            if (!args.length) return extra.reply('❌ Provide a sport name.\n\nExample: *.searchleague Soccer*\n*.searchleague Soccer England*');

            await react(sock, msg, '🏆');
            try {
                const sport = args[0];
                const country = args.slice(1).join(' ') || null;
                const params = { s: sport };
                if (country) params.c = country;

                const data = await sportsDB('search_all_leagues.php', params);
                const leagues = data.countrys || data.leagues;
                if (!leagues || !leagues.length) return send(sock, msg, `❌ No leagues found for *"${args.join(' ')}"*`);

                let text = `🏆 *Leagues — ${sport}${country ? ' / ' + country : ''}*\n━━━━━━━━━━━━━━━\n\n`;
                leagues.slice(0, 15).forEach((l, i) => {
                    text += `${i + 1}. *${l.strLeague}*`;
                    if (l.strCountry) text += ` (${l.strCountry})`;
                    text += '\n';
                    if (l.strCurrentSeason) text += `   📅 Season: ${l.strCurrentSeason}\n`;
                    if (l.idLeague)         text += `   🆔 ID: ${l.idLeague}\n`;
                    text += '\n';
                });
                if (leagues.length > 15) text += `_...and ${leagues.length - 15} more_\n\n`;
                text += `💡 Use *.leagueinfo <id>* for full details.`;
                await send(sock, msg, text.trim());
            } catch (err) {
                console.error('[searchleague]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Search failed. Please try again later.');
            }
        },
    },

    {
        name: 'leagueinfo',
        aliases: ['league', 'leaguedetails'],
        category: 'sports',
        description: 'Get full details about a league by ID',
        usage: '.leagueinfo <league id>',

        async execute(sock, msg, args, extra) {
            const id = args[0];
            if (!id) return extra.reply('❌ Provide a league ID.\n\nExample: *.leagueinfo 4328*\nUse *.searchleague* to find IDs.');

            await react(sock, msg, '🏆');
            try {
                const data = await sportsDB('lookupleague.php', { id });
                const league = data.leagues && data.leagues[0];
                if (!league) return send(sock, msg, `❌ League ID *${id}* not found.`);

                let text = `🏆 *${league.strLeague}*\n━━━━━━━━━━━━━━━\n\n`;
                if (league.strLeagueAlternate) text += `🔤 Also known as: ${league.strLeagueAlternate}\n`;
                if (league.strSport)           text += `🏅 Sport: ${league.strSport}\n`;
                if (league.strCountry)         text += `🌍 Country: ${league.strCountry}\n`;
                if (league.strGender)          text += `⚧ Gender: ${league.strGender}\n`;
                if (league.intDivision)        text += `📊 Division: ${league.intDivision}\n`;
                if (league.intFormedYear)      text += `📅 Founded: ${league.intFormedYear}\n`;
                if (league.strCurrentSeason)   text += `🗓️ Current Season: ${league.strCurrentSeason}\n`;
                if (league.dateFirstEvent)     text += `⚡ First Event: ${league.dateFirstEvent}\n`;
                if (league.strWebsite)         text += `🌐 Website: https://${league.strWebsite}\n`;
                if (league.strTwitter)         text += `🐦 Twitter: https://${league.strTwitter}\n`;
                if (league.strYoutube)         text += `▶️ YouTube: https://${league.strYoutube}\n`;
                if (league.idLeague)           text += `\n🆔 League ID: ${league.idLeague}\n`;
                if (league.strDescriptionEN) {
                    const desc = league.strDescriptionEN.trim().slice(0, 300);
                    text += `\n📝 *About:*\n${desc}${league.strDescriptionEN.length > 300 ? '...' : ''}\n`;
                }

                if (league.strBadge) {
                    await sendImage(sock, msg, league.strBadge, text.trim());
                } else {
                    await send(sock, msg, text.trim());
                }
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[leagueinfo]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Failed to get league info. Please try again later.');
            }
        },
    },

    {
        name: 'leagueseasons',
        aliases: ['seasons', 'leaguehistory'],
        category: 'sports',
        description: 'List all seasons for a league by league ID',
        usage: '.leagueseasons <league id>',

        async execute(sock, msg, args, extra) {
            const id = args[0];
            if (!id) return extra.reply('❌ Provide a league ID.\n\nExample: *.leagueseasons 4328*');

            await react(sock, msg, '📅');
            try {
                const data = await sportsDB('search_all_seasons.php', { id });
                const seasons = data.seasons;
                if (!seasons || !seasons.length) return send(sock, msg, `❌ No seasons found for league ID *${id}*.`);

                let text = `📅 *Seasons — League ${id}*\n━━━━━━━━━━━━━━━\n\n`;
                seasons.slice().reverse().slice(0, 20).forEach((s, i) => { text += `${i + 1}. ${s.strSeason}\n`; });
                if (seasons.length > 20) text += `_...and ${seasons.length - 20} more seasons_\n`;
                text += `\nTotal: ${seasons.length} seasons`;

                await send(sock, msg, text.trim());
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[leagueseasons]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Failed to get seasons. Please try again later.');
            }
        },
    },

    {
        name: 'allleagues',
        aliases: ['leagues', 'leaguelist'],
        category: 'sports',
        description: 'List all available leagues, optionally filter by sport',
        usage: '.allleagues [sport]',

        async execute(sock, msg, args, extra) {
            await react(sock, msg, '📋');
            try {
                const data = await sportsDB('all_leagues.php');
                let leagues = data.leagues || [];
                if (!leagues.length) return send(sock, msg, '❌ No leagues available.');

                const filter = args.join(' ').toLowerCase();
                if (filter) leagues = leagues.filter(l => l.strSport && l.strSport.toLowerCase().includes(filter));
                if (!leagues.length) return send(sock, msg, `❌ No leagues found for sport *"${args.join(' ')}"*.`);

                const byS = {};
                leagues.forEach(l => {
                    const s = l.strSport || 'Other';
                    if (!byS[s]) byS[s] = [];
                    byS[s].push(l);
                });

                let text = `📋 *All Leagues${filter ? ' — ' + args.join(' ') : ''}*\n━━━━━━━━━━━━━━━\n\n`;
                let shown = 0;
                for (const [sport, list] of Object.entries(byS)) {
                    if (shown >= 60) { text += `_...filter by sport to see more._`; break; }
                    text += `*${sport}* (${list.length})\n`;
                    list.slice(0, 10).forEach(l => { text += `  • ${l.strLeague} [${l.idLeague}]\n`; shown++; });
                    if (list.length > 10) text += `  _...+${list.length - 10} more_\n`;
                    text += '\n';
                }

                await send(sock, msg, text.trim());
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[allleagues]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Failed to fetch leagues. Please try again later.');
            }
        },
    },

    // ── SCHEDULE ──────────────────────────────────────────────────────────────

    {
        name: 'nextevent',
        aliases: ['nextmatch', 'upcoming', 'upcomingmatches'],
        category: 'sports',
        description: 'Get next 5 upcoming events for a team',
        usage: '.nextevent <team id or name>',

        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Provide a team ID or name.\n\nExample: *.nextevent Arsenal*\nor *.nextevent 133604*');

            await react(sock, msg, '📅');
            try {
                let teamId = query, teamName = query;
                if (!/^\d+$/.test(query)) {
                    const search = await sportsDB('searchteams.php', { t: query });
                    const team = search.teams && search.teams[0];
                    if (!team) return send(sock, msg, `❌ Team *"${query}"* not found.`);
                    teamId = team.idTeam;
                    teamName = team.strTeam;
                }

                const data = await sportsDB('eventsnext.php', { id: teamId });
                const events = data.events;
                if (!events || !events.length) return send(sock, msg, `📅 No upcoming events found for *${teamName}*.`);

                let text = `📅 *Upcoming Events — ${teamName}*\n━━━━━━━━━━━━━━━\n\n`;
                events.forEach((e, i) => {
                    text += `${i + 1}. *${e.strEvent}*\n`;
                    if (e.strLeague) text += `   🏆 ${e.strLeague}\n`;
                    if (e.strSeason) text += `   📆 Season: ${e.strSeason}\n`;
                    text += `   🕐 ${formatDateTime(e)}\n`;
                    if (e.strVenue)  text += `   🏟️ Venue: ${e.strVenue}\n`;
                    text += '\n';
                });

                await send(sock, msg, text.trim());
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[nextevent]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Failed to get upcoming events. Please try again later.');
            }
        },
    },

    {
        name: 'lastevent',
        aliases: ['lastmatch', 'results', 'recentmatches'],
        category: 'sports',
        description: 'Get last 5 results for a team',
        usage: '.lastevent <team id or name>',

        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Provide a team ID or name.\n\nExample: *.lastevent Arsenal*\nor *.lastevent 133604*');

            await react(sock, msg, '📊');
            try {
                let teamId = query, teamName = query;
                if (!/^\d+$/.test(query)) {
                    const search = await sportsDB('searchteams.php', { t: query });
                    const team = search.teams && search.teams[0];
                    if (!team) return send(sock, msg, `❌ Team *"${query}"* not found.`);
                    teamId = team.idTeam;
                    teamName = team.strTeam;
                }

                const data = await sportsDB('eventslast.php', { id: teamId });
                const events = data.results;
                if (!events || !events.length) return send(sock, msg, `📊 No recent events found for *${teamName}*.`);

                let text = `📊 *Recent Results — ${teamName}*\n━━━━━━━━━━━━━━━\n\n`;
                events.slice().reverse().forEach((e, i) => {
                    text += `${i + 1}. *${e.strEvent}*\n`;
                    if (e.strLeague) text += `   🏆 ${e.strLeague}\n`;
                    text += `   ⚽ Score: ${formatScore(e)}\n`;
                    text += `   📅 ${formatDateTime(e)}\n`;
                    if (e.strVenue)  text += `   🏟️ Venue: ${e.strVenue}\n`;
                    text += '\n';
                });

                await send(sock, msg, text.trim());
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[lastevent]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Failed to get last events. Please try again later.');
            }
        },
    },

    {
        name: 'searchevent',
        aliases: ['findevent', 'eventsearch', 'findmatch'],
        category: 'sports',
        description: 'Search for a sports event/match by name',
        usage: '.searchevent <event name>',

        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Provide an event name.\n\nExample: *.searchevent Arsenal vs Chelsea*');

            await react(sock, msg, '🔍');
            try {
                const data = await sportsDB('searchevents.php', { e: query });
                const events = data.event;
                if (!events || !events.length) return send(sock, msg, `❌ No events found for *"${query}"*`);

                let text = `🎯 *Events matching "${query}"*\n━━━━━━━━━━━━━━━\n\n`;
                events.slice(0, 8).forEach((e, i) => {
                    text += `${i + 1}. *${e.strEvent}*\n`;
                    if (e.strLeague) text += `   🏆 ${e.strLeague}\n`;
                    if (e.strSeason) text += `   📆 Season: ${e.strSeason}\n`;
                    const score = formatScore(e);
                    if (score !== 'TBD') text += `   ⚽ Score: ${score}\n`;
                    text += `   📅 ${formatDateTime(e)}\n`;
                    if (e.idEvent) text += `   🆔 ID: ${e.idEvent}\n`;
                    text += '\n';
                });
                text += `💡 Use *.matchinfo <id>* for full details.`;
                await send(sock, msg, text.trim());
            } catch (err) {
                console.error('[searchevent]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Search failed. Please try again later.');
            }
        },
    },

    {
        name: 'matchinfo',
        aliases: ['eventinfo', 'matchdetails'],
        category: 'sports',
        description: 'Get detailed info about a specific match/event by ID',
        usage: '.matchinfo <event id>',

        async execute(sock, msg, args, extra) {
            const id = args[0];
            if (!id) return extra.reply('❌ Provide an event ID.\n\nExample: *.matchinfo 2470477*\nUse *.searchevent* to find IDs.');

            await react(sock, msg, '🎯');
            try {
                const data = await sportsDB('lookupevent.php', { id });
                const event = data.events && data.events[0];
                if (!event) return send(sock, msg, `❌ Event ID *${id}* not found.`);

                let text = `🎯 *${event.strEvent}*\n━━━━━━━━━━━━━━━\n\n`;
                if (event.strSport)  text += `🏅 Sport: ${event.strSport}\n`;
                if (event.strLeague) text += `🏆 League: ${event.strLeague}\n`;
                if (event.strSeason) text += `📆 Season: ${event.strSeason}\n`;
                if (event.intRound)  text += `🔢 Round: ${event.intRound}\n`;
                text += `📅 Date/Time: ${formatDateTime(event)}\n`;

                const score = formatScore(event);
                if (score !== 'TBD') {
                    text += `\n⚽ *Score: ${score}*\n`;
                    if (event.strHomeTeam) text += `   🏠 ${event.strHomeTeam}: ${event.intHomeScore}\n`;
                    if (event.strAwayTeam) text += `   ✈️ ${event.strAwayTeam}: ${event.intAwayScore}\n`;
                } else {
                    if (event.strHomeTeam) text += `🏠 Home: ${event.strHomeTeam}\n`;
                    if (event.strAwayTeam) text += `✈️ Away: ${event.strAwayTeam}\n`;
                }

                if (event.strVenue)       text += `\n🏟️ Venue: ${event.strVenue}\n`;
                if (event.strCity)        text += `📍 City: ${event.strCity}\n`;
                if (event.strCountry)     text += `🌍 Country: ${event.strCountry}\n`;
                if (event.strOfficial)    text += `👨‍⚖️ Official: ${event.strOfficial}\n`;
                if (event.intSpectators)  text += `👥 Spectators: ${parseInt(event.intSpectators).toLocaleString()}\n`;
                if (event.idEvent)        text += `\n🆔 Event ID: ${event.idEvent}\n`;
                if (event.strDescriptionEN && event.strDescriptionEN.trim()) {
                    const desc = event.strDescriptionEN.trim().slice(0, 400);
                    text += `\n📝 *Preview:*\n${desc}${event.strDescriptionEN.length > 400 ? '...' : ''}\n`;
                }

                const thumb = event.strThumb || event.strPoster || event.strSquare;
                if (thumb) {
                    await sendImage(sock, msg, thumb, text.trim());
                } else {
                    await send(sock, msg, text.trim());
                }
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[matchinfo]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Failed to get match info. Please try again later.');
            }
        },
    },

    // ── LIVE SCORES ───────────────────────────────────────────────────────────

    {
        name: 'livescores',
        aliases: ['live', 'livescore', 'liveresults'],
        category: 'sports',
        description: 'Get current live soccer scores',
        usage: '.livescores',

        async execute(sock, msg, args, extra) {
            await react(sock, msg, '🔴');
            try {
                const data = await sportsDB('livescore.php');
                const events = data.events;
                if (!events || !events.length) {
                    return send(sock, msg,
                        `📺 *Live Scores*\n━━━━━━━━━━━━━━━\n\n⚠️ No live matches at the moment.\n\nTip: Try *.nextevent <team>* to check upcoming fixtures.`
                    );
                }

                let text = `🔴 *Live Scores*\n━━━━━━━━━━━━━━━\n\n`;
                events.forEach((e, i) => {
                    const home = e.strHomeTeam || 'Home', away = e.strAwayTeam || 'Away';
                    const hs = e.intHomeScore !== null && e.intHomeScore !== undefined ? e.intHomeScore : '-';
                    const as = e.intAwayScore !== null && e.intAwayScore !== undefined ? e.intAwayScore : '-';
                    text += `${i + 1}. 🔴 *${home} ${hs} - ${as} ${away}*\n`;
                    if (e.strLeague)   text += `   🏆 ${e.strLeague}\n`;
                    if (e.strProgress) text += `   ⏱️ ${e.strProgress}\n`;
                    if (e.strStatus)   text += `   📍 ${e.strStatus}\n`;
                    text += '\n';
                });
                text += `_Updated: ${new Date().toUTCString()}_`;

                await send(sock, msg, text.trim());
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[livescores]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Failed to fetch live scores. Please try again later.');
            }
        },
    },

    // ── SPORTS INFO ───────────────────────────────────────────────────────────

    {
        name: 'allsports',
        aliases: ['sportslist', 'listsports'],
        category: 'sports',
        description: 'List all sports available on TheSportsDB',
        usage: '.allsports',

        async execute(sock, msg, args, extra) {
            await react(sock, msg, '🏅');
            try {
                const data = await sportsDB('all_sports.php');
                const sports = data.sports;
                if (!sports || !sports.length) return send(sock, msg, '❌ No sports data available.');

                let text = `🏅 *All Sports on TheSportsDB*\n━━━━━━━━━━━━━━━\n\n`;
                sports.forEach((s, i) => {
                    const emoji = SPORT_EMOJI[s.strSport] || SPORT_EMOJI.default;
                    text += `${i + 1}. ${emoji} *${s.strSport}*\n`;
                });
                text += `\nTotal: ${sports.length} sports\n\n`;
                text += `💡 *.searchleague Soccer* — find leagues by sport\n`;
                text += `💡 *.sportinfo <sport>* — details about a sport`;

                await send(sock, msg, text.trim());
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[allsports]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Failed to fetch sports. Please try again later.');
            }
        },
    },

    {
        name: 'sportinfo',
        aliases: ['sportsinfo', 'aboutsport'],
        category: 'sports',
        description: 'Get description and info about a specific sport',
        usage: '.sportinfo <sport name>',

        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Provide a sport name.\n\nExample: *.sportinfo Soccer*\nUse *.allsports* to see all available sports.');

            await react(sock, msg, '🏅');
            try {
                const data = await sportsDB('all_sports.php');
                const sports = data.sports || [];
                const sport = sports.find(s => s.strSport && s.strSport.toLowerCase().includes(query.toLowerCase()));
                if (!sport) return send(sock, msg, `❌ Sport *"${query}"* not found.\n\nUse *.allsports* to see all available sports.`);

                const emoji = SPORT_EMOJI[sport.strSport] || SPORT_EMOJI.default;
                let text = `${emoji} *${sport.strSport}*\n━━━━━━━━━━━━━━━\n\n`;
                if (sport.strFormat) text += `📋 Format: ${sport.strFormat}\n`;
                if (sport.strSportDescription) {
                    const desc = sport.strSportDescription.trim().slice(0, 500);
                    text += `\n📝 *About:*\n${desc}${sport.strSportDescription.length > 500 ? '...' : ''}\n`;
                }
                text += `\n💡 *.searchleague ${sport.strSport}* — find leagues for this sport`;

                if (sport.strSportThumb) {
                    await sendImage(sock, msg, sport.strSportThumb, text.trim());
                } else {
                    await send(sock, msg, text.trim());
                }
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[sportinfo]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Failed to get sport info. Please try again later.');
            }
        },
    },

    {
        name: 'sportsmenu',
        aliases: ['sportshelp', 'sportscommands'],
        category: 'sports',
        description: 'Show all available sports commands',
        usage: '.sportsmenu',

        async execute(sock, msg, args, extra) {
            await send(sock, msg,
                `🏅 *Sports Commands*\n━━━━━━━━━━━━━━━\n\n` +

                `*📊 Scores & Fixtures*\n` +
                `• *.sports <league>* — results, fixtures & standings\n` +
                `• *.livescores* — current live scores\n` +
                `• *.nextevent <team>* — next 5 upcoming fixtures\n` +
                `• *.lastevent <team>* — last 5 match results\n\n` +

                `*🔍 Search*\n` +
                `• *.searchteam <name>* — find teams\n` +
                `• *.searchplayer <name>* — find players\n` +
                `• *.searchleague <sport> [country]* — find leagues\n` +
                `• *.searchevent <name>* — find a match/event\n\n` +

                `*📋 Details*\n` +
                `• *.teaminfo <id/name>* — full team profile\n` +
                `• *.playerinfo <id/name>* — full player profile\n` +
                `• *.leagueinfo <id>* — league details\n` +
                `• *.matchinfo <id>* — match details\n\n` +

                `*👥 Squad*\n` +
                `• *.teamplayers <id/name>* — full squad by position\n\n` +

                `*🏆 Leagues & Sports*\n` +
                `• *.allleagues [sport]* — browse all leagues\n` +
                `• *.leagueseasons <league id>* — season history\n` +
                `• *.allsports* — all supported sports\n` +
                `• *.sportinfo <sport>* — sport description\n\n` +

                `_Powered by TheSportsDB_`
            );
        },
    },

];
