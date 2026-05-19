/**
 * Lyrics Finder — Nexray API (text only)
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
      // ── Fetch from Nexray API ───────────────────────────────────────────
      const res = await axios.get(
        `https://api.nexray.eu.cc/search/lyrics?q=${encodeURIComponent(query)}`,
        { timeout: 15000 }
      );

      if (!res.data?.status || !res.data?.result) {
        return await sock.sendMessage(jid, {
          text: '❌ Could not find lyrics for that song. Try a different song name or spelling.'
        });
      }

      const r = res.data.result;
      let lyrics = r.lyrics?.plain_lyrics || 'No lyrics found';

      // Trim very long lyrics
      if (lyrics.length > 4000) {
        lyrics = lyrics.substring(0, 4000) + '...\n\n_Lyrics truncated — showing first part only_';
      }

      const caption =
        `🎵 *${r.title || 'Unknown Title'}*\n` +
        `👤 *Artist:* ${r.artist || 'Unknown Artist'}\n\n` +
        `📝 *Lyrics:*\n${lyrics}\n\n` +
        (r.lyrics?.synced_lyrics ? `_Synced lyrics available_` : '') + `\n\n` +
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
