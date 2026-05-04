const { keithApi } = require(require('path').join(global.__CORE__, 'utils', 'keithApi'));
const { formatObj } = require(require('path').join(global.__CORE__, 'utils', 'sportsFormatter'));

module.exports = {
  name: 'venue',
  aliases: ['stadium'],
  category: 'sports',
  description: 'Search for a stadium or venue',
  usage: '.venue <name>',

  async execute(sock, msg, args, extra) {
    if (!args.length) return extra.reply('❌ Provide a venue name.\n\nExample: *.venue Emirates Stadium*');
    await extra.react('🏟');
    try {
      const data = await keithApi('/sport/venuesearch', { q: args.join(' ') });
      const r = data.result || data;
      if (typeof r === 'string') return extra.reply(`🏟 ${r}`);

      let text = '🏟 *VENUE SEARCH*\n━━━━━━━━━━━━━━━\n\n';
      const items = Array.isArray(r) ? r : [r];
      if (!items.length) return extra.reply(text + '_No venues found_');

      for (const v of items.slice(0, 5)) {
        const name = v.name || v.venue || v.strVenue || v.stadium || '';
        text += `┏ 🏟 *${name}*\n`;
        const fields = [
          ['📍', 'Location', v.location || v.city || v.strLocation],
          ['🌍', 'Country', v.country || v.strCountry],
          ['👥', 'Capacity', v.capacity || v.intCapacity],
          ['📐', 'Surface', v.surface || v.strSurface],
          ['📅', 'Built', v.built || v.yearBuilt || v.opened],
          ['🏠', 'Home Team', v.homeTeam || v.team || v.strTeam],
          ['🌐', 'Address', v.address || v.strAddress],
          ['💰', 'Cost', v.cost || v.constructionCost],
          ['📝', 'Description', v.description || v.strDescriptionEN],
        ];
        for (const [icon, label, val] of fields) {
          if (val) {
            const vStr = String(val).length > 200 ? String(val).slice(0, 200) + '...' : val;
            text += `┃ ${icon} ${label}: ${vStr}\n`;
          }
        }
        text += '┗━━━━━━━━━━━━━━━\n\n';
      }
      await extra.reply(text.trim());
    } catch (e) {
      await extra.reply(`❌ Venue search error: ${e.message}`);
    }
  }
};
