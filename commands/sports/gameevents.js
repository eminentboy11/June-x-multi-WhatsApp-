const { keithApi } = require('../../utils/keithApi');
const { formatObj } = require('../../utils/sportsFormatter');

module.exports = {
  name: 'gameevents',
  aliases: ['events', 'h2h', 'matchhistory'],
  category: 'sports',
  description: 'Search game events / head-to-head history (e.g., Arsenal vs Chelsea)',
  usage: '.gameevents <team1 vs team2>',

  async execute(sock, msg, args, extra) {
    if (!args.length) {
      return extra.reply('❌ Provide a query.\n\nExample: *.gameevents Arsenal vs Chelsea*');
    }
    await extra.react('📜');
    try {
      const data = await keithApi('/sport/gameevents', { q: args.join(' ') });
      const r = data.result || data;
      if (typeof r === 'string') return extra.reply(`📜 ${r}`);

      let text = '📜 *GAME EVENTS HISTORY*\n━━━━━━━━━━━━━━━\n\n';
      const items = Array.isArray(r) ? r : (Array.isArray(r.events) ? r.events : [r]);
      if (!items.length) return extra.reply(text + '_No events found_');

      for (const ev of items.slice(0, 15)) {
        const home = ev.homeTeam || ev.home || ev.strHomeTeam || ev.team1 || '';
        const away = ev.awayTeam || ev.away || ev.strAwayTeam || ev.team2 || '';
        const hs = ev.homeScore ?? ev.intHomeScore ?? ev.score?.home ?? '';
        const as = ev.awayScore ?? ev.intAwayScore ?? ev.score?.away ?? '';
        const date = ev.date || ev.dateEvent || ev.utcDate || ev.strDate || '';
        const league = ev.league || ev.strLeague || ev.competition || '';
        const venue = ev.venue || ev.strVenue || '';
        const season = ev.season || ev.strSeason || '';
        const status = ev.status || ev.strStatus || '';

        if (home && away) {
          text += `┏ *${home}* ${hs !== '' ? hs : ''} - ${as !== '' ? as : ''} *${away}*\n`;
        } else {
          const title = ev.event || ev.strEvent || ev.name || 'Match';
          text += `┏ ${title}\n`;
        }
        if (league) text += `┃ 🏆 ${league}\n`;
        if (season) text += `┃ 📅 Season: ${season}\n`;
        if (date) text += `┃ 🗓 ${date}\n`;
        if (venue) text += `┃ 🏟 ${venue}\n`;
        if (status) text += `┃ 🔄 ${status}\n`;
        text += '┗━━━━━━━━━━━━━━━\n\n';
      }

      await extra.reply(text.trim());
    } catch (e) {
      await extra.reply(`❌ Game events error: ${e.message}`);
    }
  }
};
