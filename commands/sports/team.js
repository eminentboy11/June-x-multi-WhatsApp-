const { keithApi } = require(require('path').join(global.__CORE__, 'utils', 'keithApi'));
const { formatObj } = require(require('path').join(global.__CORE__, 'utils', 'sportsFormatter'));

module.exports = {
  name: 'team',
  aliases: ['teamsearch'],
  category: 'sports',
  description: 'Search for a football team',
  usage: '.team <name>',

  async execute(sock, msg, args, extra) {
    if (!args.length) return extra.reply('❌ Provide a team name.\n\nExample: *.team Arsenal*');
    await extra.react('🏟');
    try {
      const data = await keithApi('/sport/teamsearch', { q: args.join(' ') });
      const r = data.result || data;
      if (typeof r === 'string') return extra.reply(`🏟 ${r}`);

      let text = '🏟 *TEAM INFO*\n━━━━━━━━━━━━━━━\n\n';
      const items = Array.isArray(r) ? r : [r];
      if (!items.length) return extra.reply(text + '_No teams found_');

      for (const t of items.slice(0, 5)) {
        const name = t.name || t.team || t.strTeam || '';
        text += `┏ 🏟 *${name}*\n`;
        const fields = [
          ['🌍', 'Country', t.country || t.nationality || t.strCountry],
          ['🏠', 'Stadium', t.stadium || t.venue || t.strStadium],
          ['📅', 'Founded', t.founded || t.intFormedYear || t.yearFounded],
          ['🏆', 'League', t.league || t.strLeague || t.competition],
          ['👥', 'Capacity', t.capacity || t.intStadiumCapacity],
          ['🎨', 'Colors', t.colors || t.strTeamColour1],
          ['🌐', 'Website', t.website || t.strWebsite],
          ['📝', 'Description', t.description || t.strDescriptionEN],
        ];
        for (const [icon, label, val] of fields) {
          if (val) {
            const v = String(val).length > 200 ? String(val).slice(0, 200) + '...' : val;
            text += `┃ ${icon} ${label}: ${v}\n`;
          }
        }
        text += '┗━━━━━━━━━━━━━━━\n\n';
      }
      await extra.reply(text.trim());
    } catch (e) {
      await extra.reply(`❌ Team search error: ${e.message}`);
    }
  }
};
