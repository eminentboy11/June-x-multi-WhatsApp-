const { keithApi } = require(require('path').join(global.__CORE__, 'utils', 'keithApi'));
const {
  formatStandings,
  formatScorers,
  formatMatches,
  formatLivescore,
  formatNews,
  formatObj,
} = require(require('path').join(global.__CORE__, 'utils', 'sportsFormatter'));

const LEAGUES = {
  epl:        { name: 'EPL',         prefix: '/epl',        flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
  laliga:     { name: 'La Liga',     prefix: '/laliga',     flag: '🇪🇸' },
  bundesliga: { name: 'Bundesliga',  prefix: '/bundesliga', flag: '🇩🇪' },
  seriea:     { name: 'Serie A',     prefix: '/seriea',     flag: '🇮🇹' },
  ligue1:     { name: 'Ligue 1',     prefix: '/ligue1',     flag: '🇫🇷' },
  ucl:        { name: 'UCL',         prefix: '/ucl',        flag: '🏆' },
  fifa:       { name: 'FIFA',        prefix: '/fifa',       flag: '🌍' },
  euros:      { name: 'Euros',       prefix: '/euros',      flag: '🇪🇺' },
};

const SUBS = [
  { sub: 'standings',       label: 'STANDINGS', formatter: formatStandings },
  { sub: 'matches',         label: 'MATCHES',   formatter: formatMatches },
  { sub: 'scorers',         label: 'TOP SCORERS', formatter: formatScorers },
  { sub: 'upcomingmatches', label: 'UPCOMING',  formatter: formatMatches },
];

function makeLeagueEndpointCommand(key, league, subDef) {
  const cmdBase = `${key}${subDef.sub === 'upcomingmatches' ? 'upcoming' : subDef.sub}`;
  const aliases = [];
  if (subDef.sub === 'upcomingmatches') {
    aliases.push(`${key}upcomingmatches`);
    aliases.push(`${key}fixtures`);
  }
  if (subDef.sub === 'scorers') aliases.push(`${key}topscorers`);
  if (subDef.sub === 'standings') aliases.push(`${key}table`);

  return {
    name: cmdBase,
    aliases,
    category: 'sports',
    description: `${league.name} ${subDef.label.toLowerCase()}`,
    usage: `.${cmdBase}`,
    async execute(sock, msg, args, extra) {
      await extra.react(league.flag);
      try {
        const data = await keithApi(`${league.prefix}/${subDef.sub}`);
        const result = data.result || data;
        const competition = result.competition || league.name;
        let text = `${league.flag} *${competition} — ${subDef.label}*\n━━━━━━━━━━━━━━━\n\n`;
        if (typeof result === 'string') text += result;
        else text += subDef.formatter(result);
        await extra.reply(text.trim());
      } catch (e) {
        await extra.reply(`❌ ${league.name} ${subDef.label} error: ${e.message}`);
      }
    },
  };
}

const leagueCommands = [];
for (const [key, league] of Object.entries(LEAGUES)) {
  for (const subDef of SUBS) {
    leagueCommands.push(makeLeagueEndpointCommand(key, league, subDef));
  }
}

const livescore2Command = {
  name: 'livescore2',
  aliases: ['livescorehl', 'livehighlights', 'liveplus'],
  category: 'sports',
  description: 'Live football scores with video highlight links',
  usage: '.livescore2',
  async execute(sock, msg, args, extra) {
    await extra.react('🎬');
    try {
      const data = await keithApi('/livescore2');
      const r = data.result || data;
      let text = '⚽ *LIVE SCORES + HIGHLIGHTS*\n━━━━━━━━━━━━━━━\n\n';
      if (typeof r === 'string') text += r;
      else text += formatLivescore(r, { highlights: true });
      await extra.reply(text.trim());
    } catch (e) {
      await extra.reply(`❌ Livescore2 error: ${e.message}`);
    }
  },
};

const sportsListCommand = {
  name: 'sportslist',
  aliases: ['sportscmds', 'sportshelp', 'sportsmenu'],
  category: 'sports',
  description: 'List all sports endpoints / commands available',
  usage: '.sportslist',
  async execute(sock, msg, args, extra) {
    await extra.react('📋');
    const lines = [];
    lines.push('🏆 *ALL SPORTS COMMANDS*');
    lines.push('━━━━━━━━━━━━━━━\n');

    lines.push('*🔍 Search*');
    lines.push('• .player <name>  — player search');
    lines.push('• .team <name>    — team search');
    lines.push('• .venue <name>   — stadium search');
    lines.push('• .gameevents <a vs b> — head-to-head history\n');

    lines.push('*⚽ Live*');
    lines.push('• .livescore             — live scores');
    lines.push('• .livescore2            — live scores + highlights\n');

    lines.push('*🏆 League endpoints* (each is its own command)');
    for (const [k, l] of Object.entries(LEAGUES)) {
      lines.push(`${l.flag} *${l.name}*: .${k}standings · .${k}matches · .${k}scorers · .${k}upcoming`);
    }
    lines.push('\n*📰 Other*');
    lines.push('• .bet            — sure bet tips & odds');
    lines.push('• .footballnews   — latest football news');

    await extra.reply(lines.join('\n'));
  },
};

module.exports = [...leagueCommands, livescore2Command, sportsListCommand];
