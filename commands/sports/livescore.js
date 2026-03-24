const { keithApi } = require('../../utils/keithApi');
const { formatLivescore } = require('../../utils/sportsFormatter');

module.exports = {
  name: 'livescore',
  aliases: ['live', 'scores'],
  category: 'sports',
  description: 'Get live football scores',
  usage: '.livescore',

  async execute(sock, msg, args, extra) {
    await extra.react('⚽');
    try {
      const data = await keithApi('/livescore');
      const r = data.result || data;

      let text = '⚽ *LIVE SCORES*\n━━━━━━━━━━━━━━━\n\n';
      if (typeof r === 'string') { text += r; }
      else { text += formatLivescore(r); }
      await extra.reply(text.trim());
    } catch (e) {
      await extra.reply(`❌ Livescore error: ${e.message}`);
    }
  }
};
