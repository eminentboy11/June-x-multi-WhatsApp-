const { keithApi } = require('../../utils/keithApi');

module.exports = {
  name: 'google',
  aliases: ['gsearch'],
  category: 'general',
  description: 'Search Google',
  usage: '.google <query>',

  async execute(sock, msg, args, extra) {
    if (!args.length) return extra.reply('❌ Provide a search query.\n\nExample: *.google Node.js tutorial*');
    await extra.react('🔍');
    try {
      const data = await keithApi('/search/google', { q: args.join(' ') });
      const results = data.result || data.results || data;
      let text = `🔍 *Google: ${args.join(' ')}*\n━━━━━━━━━━━━━━━\n\n`;
      if (Array.isArray(results)) {
        for (const r of results.slice(0, 8)) {
          text += `📌 *${r.title || ''}*\n`;
          if (r.description || r.snippet) text += `${(r.description || r.snippet).slice(0, 150)}\n`;
          if (r.url || r.link) text += `🔗 ${r.url || r.link}\n`;
          text += '\n';
        }
      } else if (typeof results === 'string') {
        text += results;
      } else {
        text += JSON.stringify(results, null, 2).slice(0, 3000);
      }
      await extra.reply(text.trim());
    } catch (e) {
      await extra.reply(`❌ Google search error: ${e.message}`);
    }
  }
};
