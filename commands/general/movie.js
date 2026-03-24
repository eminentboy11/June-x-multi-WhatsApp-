const { keithApi } = require('../../utils/keithApi');
const axios = require('axios');

module.exports = {
  name: 'movie',
  aliases: ['moviesearch', 'film'],
  category: 'general',
  description: 'Search for a movie or TV show',
  usage: '.movie <title>',

  async execute(sock, msg, args, extra) {
    if (!args.length) return extra.reply('❌ Provide a movie title.\n\nExample: *.movie Lucifer*');
    await extra.react('🎬');
    try {
      const data = await keithApi('/search/movie', { q: args.join(' ') });
      const r = data.result || data;
      if (typeof r === 'string') return extra.reply(`🎬 ${r}`);

      let text = `🎬 *Movie Search: ${args.join(' ')}*\n━━━━━━━━━━━━━━━\n\n`;
      const items = Array.isArray(r) ? r : [r];
      for (const m of items.slice(0, 5)) {
        text += `🎥 *${m.title || m.name || ''}*\n`;
        if (m.year || m.release_date) text += `   📅 ${m.year || m.release_date}\n`;
        if (m.rating || m.vote_average) text += `   ⭐ ${m.rating || m.vote_average}\n`;
        if (m.genre || m.genres) text += `   🎭 ${m.genre || m.genres}\n`;
        if (m.overview || m.description) text += `   📝 ${(m.overview || m.description).slice(0, 200)}\n`;
        text += '\n';
      }

      const poster = items[0]?.poster || items[0]?.image || items[0]?.thumbnail;
      if (poster) {
        try {
          const resp = await axios.get(poster, { responseType: 'arraybuffer', timeout: 10000 });
          return await sock.sendMessage(extra.from, {
            image: Buffer.from(resp.data),
            caption: text.trim()
          }, { quoted: msg });
        } catch (_) {}
      }
      await extra.reply(text.trim());
    } catch (e) {
      await extra.reply(`❌ Movie search error: ${e.message}`);
    }
  }
};
