const { keithApi } = require('../../utils/keithApi');
const { formatStandings, formatScorers, formatMatches, formatObj } = require('../../utils/sportsFormatter');

const SUBCOMMANDS = {
  standings: '/epl/standings',
  matches: '/epl/matches',
  scorers: '/epl/scorers',
  upcoming: '/epl/upcomingmatches',
};

module.exports = {
  name: 'epl',
  aliases: ['premierleague', 'pl'],
  category: 'sports',
  description: 'EPL standings, matches, scorers, upcoming',
  usage: '.epl <standings|matches|scorers|upcoming>',

  async execute(sock, msg, args, extra) {
    const sub = (args[0] || 'standings').toLowerCase();
    const endpoint = SUBCOMMANDS[sub];
    if (!endpoint) return extra.reply(`❌ Unknown option. Use: *${Object.keys(SUBCOMMANDS).join(', ')}*`);

    await extra.react('🏴󠁧󠁢󠁥󠁮󠁧󠁿');
    try {
      const data = await keithApi(endpoint);
      const result = data.result || data;
      const competition = result.competition || 'EPL';
      let text = `🏴󠁧󠁢󠁥󠁮󠁧󠁿 *${competition} — ${sub.toUpperCase()}*\n━━━━━━━━━━━━━━━\n\n`;

      if (typeof result === 'string') { text += result; }
      else if (sub === 'standings') text += formatStandings(result);
      else if (sub === 'scorers') text += formatScorers(result);
      else text += formatMatches(result);

      await extra.reply(text.trim());
    } catch (e) {
      await extra.reply(`❌ EPL error: ${e.message}`);
    }
  }
};
