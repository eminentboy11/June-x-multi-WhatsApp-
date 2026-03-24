const { keithApi } = require('../../utils/keithApi');
const { formatObj } = require('../../utils/sportsFormatter');

module.exports = {
  name: 'player',
  aliases: ['playersearch'],
  category: 'sports',
  description: 'Search for a football player',
  usage: '.player <name>',

  async execute(sock, msg, args, extra) {
    if (!args.length) return extra.reply('❌ Provide a player name.\n\nExample: *.player Bukayo Saka*');
    await extra.react('🏃');
    try {
      const data = await keithApi('/sport/playersearch', { q: args.join(' ') });
      const r = data.result || data;
      if (typeof r === 'string') return extra.reply(`🏃 ${r}`);

      let text = '🏃 *PLAYER INFO*\n━━━━━━━━━━━━━━━\n\n';
      const items = Array.isArray(r) ? r : [r];
      if (!items.length) return extra.reply(text + '_No players found_');

      for (const p of items.slice(0, 5)) {
        const name = p.name || p.player || p.fullName || p.strPlayer || '';
        text += `┏ 👤 *${name}*\n`;
        const fields = [
          ['🏟', 'Team', p.team || p.strTeam || p.club],
          ['🌍', 'Nationality', p.nationality || p.country || p.strNationality],
          ['📌', 'Position', p.position || p.strPosition],
          ['🎂', 'DOB', p.dateOfBirth || p.dateBorn || p.strBirthDate || p.born || p.dob],
          ['📏', 'Height', p.height || p.strHeight],
          ['⚖️', 'Weight', p.weight || p.strWeight],
          ['👕', 'Number', p.number || p.strNumber || p.shirtNumber],
          ['💰', 'Value', p.marketValue || p.value],
          ['✍️', 'Contract', p.contract || p.contractUntil],
          ['📝', 'Description', p.description || p.strDescriptionEN],
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
      await extra.reply(`❌ Player search error: ${e.message}`);
    }
  }
};
