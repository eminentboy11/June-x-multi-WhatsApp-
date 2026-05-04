/**
 * Lyrics Finder
 */

const axios = require('axios');
const config = require(require('path').join(global.__ROOT__, 'config'));

module.exports = {
  name: 'lyrics',
  aliases: ['lyric', 'lirik'],
  category: 'media',
  description: 'Get lyrics of a song',
  usage: '<song name>',

  async execute(sock, msg, args) {
    const jid = msg.key.remoteJid;

    try {
      if (args.length === 0) {
        return await sock.sendMessage(jid, {
          text: `❌ Please provide a song name!\n\nExample: ${config.prefix}lyrics Despacito`
        });
      }

      const query = args.join(' ');
      let lyricsData = null;

      // ── Primary: apiskeith.top /search/lyrics ────────────────────────────────
      try {
        const res = await axios.get(
          `https://apiskeith.top/search/lyrics?query=${encodeURIComponent(query)}`,
          { timeout: 10000 }
        );
        // Response shape: { status: true, result: [ { song, artist, lyrics, thumbnail } ] }
        if (res.data?.status === true && Array.isArray(res.data.result) && res.data.result.length > 0) {
          const hit = res.data.result[0];
          lyricsData = {
            title:     hit.song      || 'Unknown Title',
            artist:    hit.artist    || 'Unknown Artist',
            lyrics:    hit.lyrics    || 'No lyrics found',
            thumbnail: hit.thumbnail || null
          };
        }
      } catch (err) {
        console.log('Keith lyrics API failed:', err.message);
      }

      // ── Fallback 1: Vreden ───────────────────────────────────────────────────
      if (!lyricsData) {
        try {
          const res = await axios.get(
            `https://api.vreden.my.id/api/lyrics?query=${encodeURIComponent(query)}`,
            { timeout: 10000 }
          );
          if (res.data?.result) {
            const r = res.data.result;
            lyricsData = {
              title:     r.title     || 'Unknown Title',
              artist:    r.artist    || 'Unknown Artist',
              lyrics:    r.lyrics    || 'No lyrics found',
              thumbnail: r.thumbnail || null
            };
          }
        } catch { console.log('Vreden lyrics API failed'); }
      }

      // ── Fallback 2: Siputzx ──────────────────────────────────────────────────
      if (!lyricsData) {
        try {
          const res = await axios.get(
            `https://api.siputzx.my.id/api/s/lyrics?query=${encodeURIComponent(query)}`,
            { timeout: 10000 }
          );
          if (res.data?.status && res.data?.data) {
            const d = res.data.data;
            lyricsData = {
              title:     d.title  || 'Unknown Title',
              artist:    d.artist || 'Unknown Artist',
              lyrics:    d.lyrics || 'No lyrics found',
              thumbnail: d.image  || null
            };
          }
        } catch { console.log('Siputzx lyrics API failed'); }
      }

      if (!lyricsData) {
        return await sock.sendMessage(jid, {
          text: '❌ Could not find lyrics for that song. Try a different song name or spelling.'
        });
      }

      // Trim very long lyrics
      let lyrics = lyricsData.lyrics;
      if (lyrics.length > 4000) {
        lyrics = lyrics.substring(0, 4000) + '...\n\n_Lyrics truncated — showing first part only_';
      }

      const caption =
        `🎵 *${lyricsData.title}*\n` +
        `👤 *Artist:* ${lyricsData.artist}\n\n` +
        `📝 *Lyrics:*\n${lyrics}\n\n` +
        `_Fetched by ${config.botName}_`;

      if (lyricsData.thumbnail) {
        await sock.sendMessage(jid, {
          image: { url: lyricsData.thumbnail },
          caption
        });
      } else {
        await sock.sendMessage(jid, { text: caption });
      }

    } catch (error) {
      console.error('Lyrics command error:', error);
      await sock.sendMessage(jid, {
        text: '❌ An error occurred while fetching lyrics!'
      });
    }
  }
};
