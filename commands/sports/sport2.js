/**
 * Sports Command
 * Live scores, results & standings via TheSportsDB free API (key: 3)
 */

const axios = require('axios');
const { applyFont } = require('../../utils/fontConverter');

const API_BASE = 'https://www.thesportsdb.com/api/v1/json/3';

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

const VALID_LEAGUES = Object.keys(LEAGUES).join(' | ');

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatEvent(e) {
    const home      = e.strHomeTeam || '???';
    const away      = e.strAwayTeam || '???';
    const homeScore = e.intHomeScore;
    const awayScore = e.intAwayScore;
    const date      = e.dateEvent || '';
    const time      = e.strTime ? e.strTime.slice(0, 5) : '';
    const status    = e.strStatus || '';

    const hasScore = homeScore !== null && homeScore !== undefined && homeScore !== '';

    if (hasScore) {
        return `${away} ${awayScore} - ${homeScore} ${home}  ✅ ${date}`;
    }

    return `${away} vs ${home}  🕐 ${date} ${time}`;
}

async function fetchData(endpoint) {
    const { data } = await axios.get(`${API_BASE}/${endpoint}`, {
        timeout: 10000,
    });
    return data;
}

// ── Module ────────────────────────────────────────────────────────────────────

module.exports = {
    name: 'sports',
    aliases: ['score', 'scores', 'livescore'],
    category: 'general',
    description: 'Recent results, upcoming fixtures & standings for major leagues',
    usage: '.sports <league> [next | standings]',

    async execute(sock, msg, args, extra) {
        try {
            const leagueKey = args[0]?.toLowerCase();
            const mode      = args[1]?.toLowerCase() || 'results';

            // ── No args: show help ────────────────────────────────────────────
            if (!leagueKey) {
                return extra.reply(
                    applyFont(
                        `┏━━『 SPORTS COMMAND 』━━\n\n` +
                        `Usage:\n` +
                        `  .sports <league>\n` +
                        `  .sports <league> next\n` +
                        `  .sports <league> standings\n\n` +
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
                        `Examples:\n` +
                        `  .sports epl\n` +
                        `  .sports nba next\n` +
                        `  .sports epl standings\n\n` +
                        `┗━━━━━━━━━━━━━━━━`
                    )
                );
            }

            const leagueInfo = LEAGUES[leagueKey];
            if (!leagueInfo) {
                return extra.reply(
                    `❌ Unknown league *${leagueKey}*\n\nAvailable: ${VALID_LEAGUES}`
                );
            }

            await sock.sendMessage(extra.from, { react: { text: '⏳', key: msg.key } });

            const { id, label } = leagueInfo;

            // ── Standings ─────────────────────────────────────────────────────
            if (mode === 'standings') {
                const raw   = await fetchData(`lookuptable.php?l=${id}`);
                const table = raw.table || [];

                if (!table.length) {
                    await sock.sendMessage(extra.from, { react: { text: '❌', key: msg.key } });
                    return extra.reply(`❌ No standings available for *${label}* right now.`);
                }

                const lines = table.slice(0, 20).map(row => {
                    const pos  = String(row.intRank || '').padStart(2);
                    const team = (row.strTeam || '???').padEnd(22);
                    const p    = row.intPlayed   || 0;
                    const w    = row.intWin       || 0;
                    const d    = row.intDraw      || 0;
                    const l    = row.intLoss      || 0;
                    const pts  = row.intPoints    || 0;
                    return `${pos}. ${team} P${p} W${w} D${d} L${l} | ${pts}pts`;
                });

                const text = applyFont(
                    `┏━━『 ${label} STANDINGS 』━━\n\n` +
                    lines.join('\n') +
                    `\n\n┗━━━━━━━━━━━━━━━━`
                );

                await sock.sendMessage(extra.from, { text }, { quoted: msg });
                await sock.sendMessage(extra.from, { react: { text: '✅', key: msg.key } });
                return;
            }

            // ── Next fixtures ─────────────────────────────────────────────────
            if (mode === 'next') {
                const raw    = await fetchData(`eventsnextleague.php?id=${id}`);
                const events = raw.events || [];

                if (!events.length) {
                    await sock.sendMessage(extra.from, { react: { text: '❌', key: msg.key } });
                    return extra.reply(`❌ No upcoming fixtures found for *${label}*.`);
                }

                const lines = events.slice(0, 10).map(formatEvent);

                const text = applyFont(
                    `┏━━『 ${label} UPCOMING 』━━\n\n` +
                    lines.join('\n') +
                    `\n\n┗━━━━━━━━━━━━━━━━`
                );

                await sock.sendMessage(extra.from, { text }, { quoted: msg });
                await sock.sendMessage(extra.from, { react: { text: '✅', key: msg.key } });
                return;
            }

            // ── Recent results (default) ──────────────────────────────────────
            const raw    = await fetchData(`eventspastleague.php?id=${id}`);
            const events = (raw.events || []).reverse().slice(0, 10);

            if (!events.length) {
                await sock.sendMessage(extra.from, { react: { text: '❌', key: msg.key } });
                return extra.reply(`❌ No recent results found for *${label}*.`);
            }

            const lines = events.map(formatEvent);

            const text = applyFont(
                `┏━━『 ${label} RESULTS 』━━\n\n` +
                lines.join('\n') +
                `\n\n┗━━━━━━━━━━━━━━━━`
            );

            await sock.sendMessage(extra.from, { text }, { quoted: msg });
            await sock.sendMessage(extra.from, { react: { text: '✅', key: msg.key } });

        } catch (error) {
            console.error('[Sports] error:', error.message);
            await sock.sendMessage(extra.from, { react: { text: '❌', key: msg.key } });
            await extra.reply(`❌ Failed to fetch sports data: ${error.message}`);
        }
    }
};
