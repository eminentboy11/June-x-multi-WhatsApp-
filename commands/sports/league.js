const { keithApi } = require('../../utils/keithApi');
const { formatStandings, formatScorers, formatMatches, formatObj } = require('../../utils/sportsFormatter');

const LEAGUES = {
  laliga:     { name: 'La Liga',     prefix: '/laliga',     flag: '🇪🇸' },
  bundesliga: { name: 'Bundesliga',  prefix: '/bundesliga', flag: '🇩🇪' },
  seriea:     { name: 'Serie A',     prefix: '/seriea',     flag: '🇮🇹' },
  ligue1:     { name: 'Ligue 1',     prefix: '/ligue1',     flag: '🇫🇷' },
  ucl:        { name: 'UCL',         prefix: '/ucl',        flag: '🏆' },
  fifa:       { name: 'FIFA',        prefix: '/fifa',       flag: '🌍' },
  euros:      { name: 'Euros',       prefix: '/euros',      flag: '🇪🇺' },
};

const SUBS = ['standings', 'matches', 'scorers', 'upcomingmatches'];

function makeCommand(key, league) {
  return {
    name: key,
    aliases: [],
    category: 'sports',
    description: `${league.name} standings, matches, scorers, upcoming`,
    usage: `.${key} <standings|matches|scorers|upcoming>`,

    async execute(sock, msg, args, extra) {
      let sub = (args[0] || 'standings').toLowerCase();
      if (sub === 'upcoming') sub = 'upcomingmatches';
      if (!SUBS.includes(sub)) return extra.reply('❌ Use: *standings, matches, scorers, upcoming*');

      await extra.react(league.flag);
      try {
        const data = await keithApi(`${league.prefix}/${sub}`);
        const result = data.result || data;
        const competition = result.competition || league.name;

        const label = sub === 'upcomingmatches' ? 'UPCOMING' : sub.toUpperCase();
        let text = `${league.flag} *${competition} — ${label}*\n━━━━━━━━━━━━━━━\n\n`;

        if (typeof result === 'string') { text += result; }
        else if (sub === 'standings') text += formatStandings(result);
        else if (sub === 'scorers') text += formatScorers(result);
        else text += formatMatches(result);

        await extra.reply(text.trim());
      } catch (e) {
        await extra.reply(`❌ ${league.name} error: ${e.message}`);
      }
    }
  };
}

module.exports = Object.entries(LEAGUES).map(([k, v]) => makeCommand(k, v));
