// commands/lyrics.js

const { applyFont } = require('../../utils/fontConverter');
const axios = require('axios');

module.exports = [
  {
    name: 'lyrics',
    aliases: ['lyric', 'songlyrics'],
    category: 'media',
    desc: 'Search for song lyrics',
    usage: '.lyrics <song name>',

    async handler({ sock, msg, args, extra }) {
      const query = args.join(' ').trim();
      const jid = msg.key.remoteJid;

      const react = (emoji) => sock.sendMessage(jid, {
        react: { text: emoji, key: msg.key }
      });

      if (!query) {
        return extra.reply(applyFont('❌ Please provide a song name.\nExample: .lyrics faded', 'bold'));
      }

      await react('🔍');

      let data;
      try {
        const res = await axios.get(`https://ravenn.site/search/lyrics?query=${encodeURIComponent(query)}`);
        data = res.data;
      } catch {
        await react('❌');
        return extra.reply(applyFont('❌ Failed to reach the lyrics API. Try again later.', 'bold'));
      }

      if (!data?.status || !Array.isArray(data.result) || data.result.length === 0) {
        await react('❌');
        return extra.reply(applyFont(`❌ No lyrics found for: ${query}`, 'bold'));
      }

      await react('✅');
      await sendLyrics(sock, msg, jid, data.result[0]);
    }
  }
];

// ─── Helper: send formatted lyrics ───────────────────────────────────────────
async function sendLyrics(sock, msg, jid, song) {
  const MAX_CHARS = 3800;
  let lyrics = song.lyrics || 'No lyrics available.';

  if (lyrics.length > MAX_CHARS) {
    lyrics = lyrics.slice(0, MAX_CHARS) + '\n\n... *(lyrics trimmed)*';
  }

  const caption =
    applyFont(`🎵 ${song.song}`, 'bold') + '\n' +
    applyFont(`👤 ${song.artist}`, 'italic') + '\n' +
    '─'.repeat(28) + '\n\n' +
    lyrics + '\n\n' +
    applyFont('🎼 JuneX • Lyrics', 'sans');

  try {
    await sock.sendMessage(jid, {
      image: { url: song.thumbnail },
      caption,
      mimetype: 'image/jpeg'
    }, { quoted: msg });
  } catch {
    await sock.sendMessage(jid, { text: caption }, { quoted: msg });
  }
}
