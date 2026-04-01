const { keithApi } = require('../../utils/keithApi');

module.exports = {
  name: 'ytsearch',
  aliases: ['youtubesearch'],
  category: 'general',
  description: 'Search YouTube videos',
  usage: '.ytsearch <query>',

  async execute(sock, msg, args, extra) {
    if (!args.length) return extra.reply('❌ Provide a search query.\n\nExample: *.ytsearch Alan Walker Faded*');
    await extra.react('▶️');
    try {
      const data = await keithApi('/search/yts', { q: args.join(' ') });
      const results = data.result || data.results || data;
      let text = `▶️ *YouTube: ${args.join(' ')}*\n━━━━━━━━━━━━━━━\n\n`;
      if (Array.isArray(results)) {
        for (const r of results.slice(0, 8)) {
          text += `🎬 *${r.title || ''}*\n`;
          if (r.duration || r.timestamp) text += `   ⏱ ${r.duration || r.timestamp}\n`;
          if (r.views) text += `   👁 ${r.views} views\n`;
          if (r.url || r.link) text += `   🔗 ${r.url || r.link}\n`;
          text += '\n';
        }
      } else if (typeof results === 'string') {
        text += results;
      } else {
        text += JSON.stringify(results, null, 2).slice(0, 3000);
      }
      await extra.reply(text.trim());
    } catch (e) {
      await extra.reply(`❌ YouTube search error: ${e.message}`);
    }
  }
};
