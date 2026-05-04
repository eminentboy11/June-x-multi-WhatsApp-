const { keithApi } = require(require('path').join(global.__CORE__, 'utils', 'keithApi'));
const { formatLivescore } = require(require('path').join(global.__CORE__, 'utils', 'sportsFormatter'));

module.exports = {
  name: 'livescore',
  aliases: ['live', 'scores'],
  category: 'sports',
  description: 'Get live football scores (use "highlights" for video links)',
  usage: '.livescore [highlights]',

  async execute(sock, msg, args, extra) {
    const sub = (args[0] || '').toLowerCase();
    const withHighlights = ['2', 'hl', 'highlights', 'video', 'videos'].includes(sub);
    const endpoint = withHighlights ? '/livescore2' : '/livescore';

    await extra.react('⚽');
    try {
      const data = await keithApi(endpoint);
      const r = data.result || data;

      let text = withHighlights
        ? '⚽ *LIVE SCORES + HIGHLIGHTS*\n━━━━━━━━━━━━━━━\n\n'
        : '⚽ *LIVE SCORES*\n━━━━━━━━━━━━━━━\n\n';

      if (typeof r === 'string') { text += r; }
      else { text += formatLivescore(r, { highlights: withHighlights }); }
      await extra.reply(text.trim());
    } catch (e) {
      await extra.reply(`❌ Livescore error: ${e.message}`);
    }
  }
};
