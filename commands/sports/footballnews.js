const { keithApi } = require(require('path').join(global.__CORE__, 'utils', 'keithApi'));
const { formatNews } = require(require('path').join(global.__CORE__, 'utils', 'sportsFormatter'));

module.exports = {
  name: 'footballnews',
  aliases: ['fnews', 'soccernews'],
  category: 'sports',
  description: 'Get latest football news',
  usage: '.footballnews',

  async execute(sock, msg, args, extra) {
    await extra.react('📰');
    try {
      const data = await keithApi('/football/news');
      const r = data.result || data;
      let text = '📰 *FOOTBALL NEWS*\n━━━━━━━━━━━━━━━\n\n';

      if (typeof r === 'string') { text += r; }
      else { text += formatNews(r); }

      await extra.reply(text.trim());
    } catch (e) {
      await extra.reply(`❌ Football news error: ${e.message}`);
    }
  }
};
