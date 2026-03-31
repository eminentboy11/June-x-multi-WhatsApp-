const { keithApi } = require('../../utils/keithApi');
const axios = require('axios');

module.exports = {
  name: 'spotify',
  aliases: ['spotifysearch', 'sp'],
  category: 'general',
  description: 'Search Spotify for music',
  usage: '.spotify <song name>',

  async execute(sock, msg, args, extra) {
    if (!args.length) return extra.reply('❌ Provide a song name.\n\nExample: *.spotify Faded Alan Walker*');
    await extra.react('🎵');
    try {
      const data = await keithApi('/search/spotify', { q: args.join(' ') });
      const results = data.result || data.results || data;
      let text = `🎵 *Spotify: ${args.join(' ')}*\n━━━━━━━━━━━━━━━\n\n`;
      if (Array.isArray(results)) {
        for (const r of results.slice(0, 8)) {
          text += `🎶 *${r.title || r.name || ''}*\n`;
          if (r.artist || r.artists) text += `   🎤 ${r.artist || r.artists}\n`;
          if (r.duration) text += `   ⏱ ${r.duration}\n`;
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
      await extra.reply(`❌ Spotify search error: ${e.message}`);
    }
  }
};
