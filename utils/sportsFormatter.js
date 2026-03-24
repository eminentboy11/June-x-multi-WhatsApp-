function extractArray(result, ...keys) {
  if (Array.isArray(result)) return result;
  if (result && typeof result === 'object') {
    for (const k of keys) {
      if (Array.isArray(result[k])) return result[k];
    }
    for (const val of Object.values(result)) {
      if (Array.isArray(val)) return val;
    }
  }
  return null;
}

function formatStandings(result) {
  const arr = extractArray(result, 'standings', 'table', 'ranking') || (Array.isArray(result) ? result : []);
  if (!arr.length) return '_No standings data_';
  let text = '';
  for (const item of arr.slice(0, 20)) {
    const pos = item.position || item.rank || item.pos || item['#'] || '';
    const team = item.team || item.name || item.club || item.strTeam || '';
    const pts = item.points ?? item.pts ?? '';
    const played = item.played ?? item.playedGames ?? item.mp ?? item.gamesPlayed ?? '';
    const won = item.won ?? item.w ?? '';
    const drawn = item.drawn ?? item.draw ?? item.d ?? '';
    const lost = item.lost ?? item.l ?? '';
    const gf = item.goalsFor ?? item.gf ?? '';
    const ga = item.goalsAgainst ?? item.ga ?? '';
    const gd = item.goalDifference ?? item.gd ?? '';

    text += `*${pos}.* ${team}`;
    if (pts !== '') text += ` — *${pts} pts*`;
    const stats = [];
    if (played !== '') stats.push(`P:${played}`);
    if (won !== '') stats.push(`W:${won}`);
    if (drawn !== '') stats.push(`D:${drawn}`);
    if (lost !== '') stats.push(`L:${lost}`);
    if (gf !== '' && ga !== '') stats.push(`${gf}:${ga}`);
    if (gd !== '') stats.push(`GD:${gd}`);
    if (stats.length) text += `\n    ${stats.join(' │ ')}`;
    text += '\n';
  }
  return text;
}

function formatScorers(result) {
  const arr = extractArray(result, 'topScorers', 'scorers', 'goalscorers') || (Array.isArray(result) ? result : []);
  if (!arr.length) return '_No scorers data_';
  let text = '';
  for (const [i, item] of arr.slice(0, 20).entries()) {
    const rank = item.rank || (i + 1);
    const player = item.player || item.name || item.strPlayer || '';
    const team = item.team || item.club || item.strTeam || '';
    const goals = item.goals ?? item.scored ?? item.numberOfGoals ?? '';
    const assists = item.assists ?? '';
    const penalties = item.penalties ?? '';

    text += `*${rank}.* ⚽ ${player}`;
    if (team) text += ` (${team})`;
    text += '\n';
    const stats = [];
    if (goals !== '') stats.push(`Goals: *${goals}*`);
    if (assists !== '') stats.push(`Assists: ${assists}`);
    if (penalties !== '') stats.push(`Pens: ${penalties}`);
    if (stats.length) text += `    ${stats.join(' │ ')}\n`;
  }
  return text;
}

function formatMatches(result) {
  const arr = extractArray(result, 'matches', 'upcomingMatches', 'fixtures', 'games') || (Array.isArray(result) ? result : []);
  if (!arr.length) return '_No matches data_';
  let text = '';
  for (const item of arr.slice(0, 15)) {
    const home = item.homeTeam || item.home || item.team1 || item.hometeam || '';
    const away = item.awayTeam || item.away || item.team2 || item.awayteam || '';
    const score = item.score || item.result || '';
    const winner = item.winner || '';
    const date = item.date || item.utcDate || item.time || '';
    const matchday = item.matchday || '';
    const status = item.status || item.state || '';

    text += `┏ ${home} vs ${away}\n`;
    if (score) text += `┃ 📊 Score: ${typeof score === 'object' ? `${score.home ?? score.fullTime?.home ?? ''} - ${score.away ?? score.fullTime?.away ?? ''}` : score}\n`;
    if (winner) text += `┃ 🏆 Winner: ${winner}\n`;
    if (matchday) text += `┃ 📋 Matchday: ${matchday}\n`;
    if (date) text += `┃ 📅 ${date}\n`;
    if (status) text += `┃ 🔄 ${status}\n`;
    text += '┗━━━━━━━━━━━━━━━\n\n';
  }
  return text;
}

function formatLivescore(result) {
  const gamesObj = result.games || result;
  let games;
  if (Array.isArray(gamesObj)) {
    games = gamesObj;
  } else if (gamesObj && typeof gamesObj === 'object') {
    games = Object.values(gamesObj);
  } else {
    return '_No live games right now_';
  }
  if (!games.length) return '_No live games right now_';

  let text = '';
  for (const g of games.slice(0, 20)) {
    const home = g.p1 || g.home || g.homeTeam || g.team1 || '';
    const away = g.p2 || g.away || g.awayTeam || g.team2 || '';
    const r = g.R || {};
    const s1 = r.r1 ?? g.homeScore ?? g.s1 ?? g.score1 ?? '';
    const s2 = r.r2 ?? g.awayScore ?? g.s2 ?? g.score2 ?? '';
    const status = r.st || g.status || g.time || '';
    const date = g.dt || '';
    const time = g.tm || '';

    text += `┏ ${home} *${s1}* - *${s2}* ${away}\n`;
    const info = [];
    if (status) info.push(`⏱ ${status}`);
    if (date && time) info.push(`📅 ${date} ${time}`);
    else if (date) info.push(`📅 ${date}`);
    if (info.length) text += `┃ ${info.join(' │ ')}\n`;
    text += '┗━━━━━━━━━━━━━━━\n\n';
  }
  return text;
}

function formatNews(result) {
  let items;
  if (result.data && result.data.items) items = result.data.items;
  else if (result.items) items = result.items;
  else if (Array.isArray(result)) items = result;
  else {
    for (const val of Object.values(result)) {
      if (Array.isArray(val)) { items = val; break; }
    }
  }
  if (!items || !items.length) return '_No news available_';

  let text = '';
  for (const [i, news] of items.slice(0, 10).entries()) {
    const title = news.title || news.headline || news.name || '';
    const desc = news.summary || news.description || news.snippet || news.content || '';
    const url = news.url || news.link || news.source || '';
    const date = news.date || news.publishedAt || news.time || '';

    text += `*${i + 1}. ${title}*\n`;
    if (date) text += `📅 ${date}\n`;
    if (desc) text += `${String(desc).slice(0, 200)}\n`;
    if (url) text += `🔗 ${url}\n`;
    text += '\n';
  }
  return text;
}

function formatObj(obj) {
  if (obj === null || obj === undefined) return '_No data available_';
  if (typeof obj !== 'object') return String(obj);
  if (Array.isArray(obj)) {
    if (obj.length === 0) return '_No data available_';
    return obj.slice(0, 15).map((item, i) => {
      if (typeof item === 'string') return `${i + 1}. ${item}`;
      return formatSingleObj(item, i + 1);
    }).join('\n');
  }
  if (Object.keys(obj).length === 0) return '_No data available_';

  const arrVal = extractArray(obj);
  if (arrVal && arrVal.length) {
    return arrVal.slice(0, 15).map((item, i) => {
      if (typeof item === 'string') return `${i + 1}. ${item}`;
      return formatSingleObj(item, i + 1);
    }).join('\n');
  }
  return formatSingleObj(obj);
}

function formatSingleObj(obj, num) {
  if (typeof obj !== 'object' || obj === null) return String(obj);
  let text = '';
  const entries = Object.entries(obj);
  const title = obj.name || obj.title || obj.team || obj.player || '';
  if (title && num) text += `*${num}. ${title}*\n`;
  else if (title) text += `*${title}*\n`;

  for (const [key, val] of entries) {
    if (['name', 'title', 'team', 'player'].includes(key) && val === title) continue;
    if (val === null || val === undefined || val === '') continue;
    if (typeof val === 'object') continue;
    const label = key.replace(/([A-Z])/g, ' $1').replace(/[_-]/g, ' ').replace(/^str\s*/i, '').trim();
    const displayLabel = label.charAt(0).toUpperCase() + label.slice(1);
    const displayVal = String(val).length > 200 ? String(val).slice(0, 200) + '...' : val;
    text += `  ${displayLabel}: ${displayVal}\n`;
  }
  text += '\n';
  return text;
}

module.exports = { formatStandings, formatScorers, formatMatches, formatLivescore, formatNews, formatObj, extractArray };
