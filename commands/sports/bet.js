const { keithApi } = require(require('path').join(global.__CORE__, 'utils', 'keithApi'));
const { formatObj } = require(require('path').join(global.__CORE__, 'utils', 'sportsFormatter'));

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
      const matches = data.result || data;

      let text = '🎰 *BET TIPS & ODDS*\n━━━━━━━━━━━━━━━\n\n';

      if (typeof matches === 'string') {
        text += matches;
      } else if (Array.isArray(matches) && matches.length) {
        for (const [i, match] of matches.slice(0, 15).entries()) {
          const { match: matchName, league, time, predictions } = match;
          const { fulltime, over_2_5, bothTeamToScore, value_bets } = predictions;

          // Determine the most likely full‑time outcome
          const fulltimeEntries = Object.entries(fulltime);
          const bestFulltime = fulltimeEntries.reduce((a, b) => (a[1] > b[1] ? a : b));
          const fulltimeTip = `${bestFulltime[0]} (${bestFulltime[1].toFixed(1)}%)`;

          // Over 2.5 – show the higher probability option
          const overTip = over_2_5.yes >= over_2_5.no ? 'Yes' : 'No';
          const overPct = over_2_5[overTip.toLowerCase()];

          // Both teams to score – always show "Yes" percentage
          const bttsPct = bothTeamToScore.yes;

          text += `┏ *${i + 1}. ${matchName}*\n`;
          text += `┃ 🏆 ${league}\n`;
          if (time) text += `┃ 🕐 ${time}\n`;
          text += `┃ 💡 Full‑time: ${fulltimeTip}\n`;
          text += `┃ 📊 Over 2.5: ${overTip} (${overPct.toFixed(1)}%) | BTTS: Yes (${bttsPct.toFixed(1)}%)\n`;
          text += `┃ 💰 Value bet: ${value_bets === 1 ? 'Yes' : 'No'}\n`;
          text += '┗━━━━━━━━━━━━━━━\n\n';
        }
      } else if (typeof matches === 'object') {
        text += formatObj(matches);
      } else {
        text += '_No tips available right now_';
      }

      await extra.reply(text.trim());
    } catch (e) {
      await extra.reply(`❌ Bet tips error: ${e.message}`);
    }
  }
};
