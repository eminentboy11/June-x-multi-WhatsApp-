const { keithApi } = require(require('path').join(global.__CORE__, 'utils', 'keithApi'));

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

      const items = Array.isArray(r) ? r : (Array.isArray(r?.events) ? r.events : (r ? [r] : []));
      if (!items.length) {
        return extra.reply(`📜 *GAME EVENTS HISTORY*\n━━━━━━━━━━━━━━━\n\n_No events found for_ *${args.join(' ')}*`);
      }

      let text = `📜 *GAME EVENTS HISTORY*\n_${args.join(' ')}_\n━━━━━━━━━━━━━━━\n\n`;

      for (const ev of items.slice(0, 10)) {
        // Teams (nested or flat)
        const homeName = ev?.teams?.home?.name || ev.homeTeam || ev.home || ev.strHomeTeam || ev.team1 || '';
        const awayName = ev?.teams?.away?.name || ev.awayTeam || ev.away || ev.strAwayTeam || ev.team2 || '';
        const homeScore = ev?.teams?.home?.score ?? ev.homeScore ?? ev.intHomeScore ?? ev.score?.home ?? '';
        const awayScore = ev?.teams?.away?.score ?? ev.awayScore ?? ev.intAwayScore ?? ev.score?.away ?? '';

        // Meta (nested or flat)
        const league  = ev?.league?.name || ev.league || ev.strLeague || ev.competition || '';
        const season  = ev.season || ev.strSeason || '';
        const round   = ev.round || ev.matchday || '';
        const sport   = ev.sport || '';
        const status  = ev.status || ev.strStatus || '';

        const date    = ev?.dateTime?.date || ev.date || ev.dateEvent || ev.utcDate || ev.strDate || '';
        const time    = ev?.dateTime?.localTime || ev?.dateTime?.time || ev.time || '';

        const venueName    = ev?.venue?.name || ev.venue || ev.strVenue || '';
        const venueCountry = ev?.venue?.country || ev.country || '';
        const venueCity    = ev?.venue?.city || '';
        const venueLine    = [venueName, [venueCity, venueCountry].filter(Boolean).join(', ')].filter(Boolean).join(' — ');

        const video = ev?.media?.video || ev.video || '';
        const title = ev.match || (homeName && awayName ? `${homeName} vs ${awayName}` : (ev.event || ev.strEvent || ev.name || 'Match'));

        // Title line
        if (homeName && awayName && (homeScore !== '' || awayScore !== '')) {
          text += `┏ *${homeName}* ${homeScore} - ${awayScore} *${awayName}*\n`;
        } else {
          text += `┏ *${title}*\n`;
        }

        if (sport)        text += `┃ 🎯 ${sport}\n`;
        if (league)       text += `┃ 🏆 ${league}\n`;
        if (season)       text += `┃ 📅 Season: ${season}${round ? ` · Round ${round}` : ''}\n`;
        else if (round)   text += `┃ 📋 Round: ${round}\n`;
        if (date && time) text += `┃ 🗓 ${date} ${String(time).slice(0, 5)}\n`;
        else if (date)    text += `┃ 🗓 ${date}\n`;
        if (venueLine)    text += `┃ 🏟 ${venueLine}\n`;
        if (status)       text += `┃ 🔄 ${status}\n`;
        if (video)        text += `┃ 🎬 ${video}\n`;
        text += '┗━━━━━━━━━━━━━━━\n\n';
      }

      if (items.length > 10) text += `_+ ${items.length - 10} more match(es) not shown_`;

      await extra.reply(text.trim());
    } catch (e) {
      await extra.reply(`❌ Game events error: ${e.message}`);
    }
  },
};
