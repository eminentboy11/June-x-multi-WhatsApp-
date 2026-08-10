/**
 * Lyrics Finder — ravenn.site API
 */

const axios = require('axios');
const config = require('../../config');

module.exports = {
  name: 'lyrics',
  aliases: ['lyric', 'lirik'],
  category: 'media',
  description: 'Get lyrics of a song',
  usage: '<song name>',

  async execute(sock, msg, args) {
    const jid = msg.key.remoteJid;

    if (args.length === 0) {
      return await sock.sendMessage(jid, {
        text: `❌ Please provide a song name!\n\nExample: ${config.prefix}lyrics Despacito`
      });
    }

    const query = args.join(' ');

    try {
      const res = await axios.get(
        `https://apiskeith2-production-3020.up.railway.app/search/lyrics?query=${encodeURIComponent(query)}`,
        { timeout: 15000 }
      );

      if (!res.data?.status || !Array.isArray(res.data?.result) || res.data.result.length === 0) {
        return await sock.sendMessage(jid, {
          text: '❌ Could not find lyrics for that song. Try a different song name or spelling.'
        });
      }

      const r = res.data.result[0];
      let lyrics = r.lyrics || 'No lyrics found.';

      if (lyrics.length > 4000) {
        lyrics = lyrics.substring(0, 4000) + '...\n\n_Lyrics truncated — showing first part only_';
      }

      const caption =
        `🎵 *${r.song || 'Unknown Title'}*\n` +
        `👤 *Artist:* ${r.artist || 'Unknown Artist'}\n\n` +
        `📝 *Lyrics:*\n${lyrics}\n\n` +
        `_Fetched by ${config.botName}_`;

      if (r.thumbnail) {
        await sock.sendMessage(jid, {
          image: { url: r.thumbnail },
          caption
        }, { quoted: msg });
      } else {
        await sock.sendMessage(jid, { text: caption }, { quoted: msg });
      }

    } catch (error) {
      console.error('Lyrics command error:', error);
      await sock.sendMessage(jid, {
        text: '❌ An error occurred while fetching lyrics!'
      });
    }
  }
};
