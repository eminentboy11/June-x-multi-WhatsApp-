const { keithApi } = require('../../utils/keithApi');
const { formatObj } = require('../../utils/sportsFormatter');

module.exports = {
  name: 'bet',
  aliases: ['odds', 'tips', 'betting'],
  category: 'sports',
  description: 'Get sure bet tips and odds',
  usage: '.bet',

  async execute(sock, msg, args, extra) {
    await extra.react('🎰');
    try {
      const data = await keithApi('/bet');
      const r = data.result || data;
      let text = '🎰 *BET TIPS & ODDS*\n━━━━━━━━━━━━━━━\n\n';

      if (typeof r === 'string') { text += r; }
      else if (Array.isArray(r)) {
        for (const [i, tip] of r.slice(0, 15).entries()) {
          const match = tip.match || tip.game || tip.teams || tip.event || '';
          const league = tip.league || tip.competition || tip.tournament || '';
          const prediction = tip.prediction || tip.tip || tip.pick || '';
          const odds = tip.odds || tip.odd || '';
          const time = tip.time || tip.date || tip.kickoff || '';
          const result = tip.result || tip.score || '';

          text += `┏ *${i + 1}. ${match}*\n`;
          if (league) text += `┃ 🏆 ${league}\n`;
          if (time) text += `┃ 🕐 ${time}\n`;
          if (prediction) text += `┃ 💡 Tip: *${prediction}*\n`;
          if (odds) text += `┃ 📊 Odds: ${odds}\n`;
          if (result) text += `┃ ✅ Result: ${result}\n`;
          text += '┗━━━━━━━━━━━━━━━\n\n';
        }
        if (r.length === 0) text += '_No tips available right now_';
      } else {
        text += formatObj(r);
      }
      await extra.reply(text.trim());
    } catch (e) {
      await extra.reply(`❌ Bet tips error: ${e.message}`);
    }
  }
};
