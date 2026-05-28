/**
 * Sports Command
 * Results, upcoming fixtures & standings via TheSportsDB free API (key: 3)
 */

const axios = require('axios');
const { applyFont } = require('../../utils/fontConverter');

const API_BASE = 'https://www.thesportsdb.com/api/v1/json/3';

const LEAGUES = {
    epl:  { id: '4328', label: '⚽ Premier League'   },
    nba:  { id: '4387', label: '🏀 NBA'              },
    nfl:  { id: '4391', label: '🏈 NFL'              },
    mlb:  { id: '4424', label: '⚾ MLB'              },
    nhl:  { id: '4380', label: '🏒 NHL'              },
    ll:   { id: '4335', label: '⚽ La Liga'          },
    ucl:  { id: '4480', label: '🏆 Champions League' },
    mls:  { id: '4346', label: '⚽ MLS'              },
    sera: { id: '4332', label: '⚽ Serie A'          },
    bund: { id: '4331', label: '⚽ Bundesliga'       },
};

const VALID_LEAGUES = Object.keys(LEAGUES).join(' | ');
const MAX_MSG_LENGTH = 3500; // WhatsApp safe limit per message

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatEvent(e) {
    const home      = e.strHomeTeam || '???';
    const away      = e.strAwayTeam || '???';
    const homeScore = e.intHomeScore;
    const awayScore = e.intAwayScore;
    const date      = e.dateEvent || '';
    const time      = e.strTime ? e.strTime.slice(0, 5) : '';
    const hasScore  = homeScore !== null && homeScore !== undefined && homeScore !== '';

    if (hasScore) {
        return `${away} ${awayScore} - ${homeScore} ${home}  ✅ ${date}`;
    }
    return `${away} vs ${home}  🕐 ${date} ${time}`;
}

// Split long message into chunks and send sequentially
async function sendChunked(sock, chatId, msg, header, lines, footer) {
    const chunks = [];
    let current  = '';

    for (const line of lines) {
        if ((current + line + '\n').length > MAX_MSG_LENGTH) {
            chunks.push(current);
            current = '';
        }
        current += line + '\n';
    }
    if (current) chunks.push(current);

    for (let i = 0; i < chunks.length; i++) {
        const isFirst = i === 0;
        const isLast  = i === chunks.length - 1;
        const part    = chunks.length > 1 ? ` (${i + 1}/${chunks.length})` : '';

        const text = applyFont(
            (isFirst ? `${header}${part}\n\n` : `${header}${part} cont...\n\n`) +
            chunks[i] +
            (isLast ? `\n${footer}` : '')
        );

        await sock.sendMessage(chatId, { text }, { quoted: isFirst ? msg : undefined });
    }
}

async function fetchData(endpoint) {
    const { data } = await axios.get(`${API_BASE}/${endpoint}`, { timeout: 10000 });
    return data;
}

// ── Module ────────────────────────────────────────────────────────────────────

module.exports = {
    name: 'sports',
    aliases: ['score', 'scores', 'livescore'],
    category: 'general',
    description: 'Results, upcoming fixtures & standings for major leagues',
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

                const lines = table.map(row => {
                    const pos  = String(row.intRank || '').padStart(2);
                    const team = (row.strTeam || '???').padEnd(22);
                    const p    = row.intPlayed || 0;
                    const w    = row.intWin    || 0;
                    const d    = row.intDraw   || 0;
                    const l    = row.intLoss   || 0;
                    const pts  = row.intPoints || 0;
                    return `${pos}. ${team} P${p} W${w} D${d} L${l} | ${pts}pts`;
                });

                await sendChunked(
                    sock, extra.from, msg,
                    `┏━━『 ${label} STANDINGS 』━━`,
                    lines,
                    `┗━━━━━━━━━━━━━━━━`
                );

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

                const lines = events.map(formatEvent);

                await sendChunked(
                    sock, extra.from, msg,
                    `┏━━『 ${label} UPCOMING (${lines.length} games) 』━━`,
                    lines,
                    `┗━━━━━━━━━━━━━━━━`
                );

                await sock.sendMessage(extra.from, { react: { text: '✅', key: msg.key } });
                return;
            }

            // ── Recent results (default) ──────────────────────────────────────
            const raw    = await fetchData(`eventspastleague.php?id=${id}`);
            const events = (raw.events || []).reverse();

            if (!events.length) {
                await sock.sendMessage(extra.from, { react: { text: '❌', key: msg.key } });
                return extra.reply(`❌ No recent results found for *${label}*.`);
            }

            const lines = events.map(formatEvent);

            await sendChunked(
                sock, extra.from, msg,
                `┏━━『 ${label} RESULTS (${lines.length} games) 』━━`,
                lines,
                `┗━━━━━━━━━━━━━━━━`
            );

            await sock.sendMessage(extra.from, { react: { text: '✅', key: msg.key } });

        } catch (error) {
            console.error('[Sports] error:', error.message);
            await sock.sendMessage(extra.from, { react: { text: '❌', key: msg.key } });
            await extra.reply(`❌ Failed to fetch sports data: ${error.message}`);
        }
    }
};
