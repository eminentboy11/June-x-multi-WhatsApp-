// commands/lyrics.js

const { applyFont } = require('../../utils/fontConverter');
const { sendButtons } = require('gifted-btns');
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

      if (!query) {
        return extra.reply(applyFont('❌ Please provide a song name.\nExample: .lyrics faded', 'bold'));
      }

      await extra.reply(applyFont('🔍 Searching lyrics...', 'italic'));

      let data;
      try {
        const res = await axios.get(`https://ravenn.site/search/lyrics?query=${encodeURIComponent(query)}`);
        data = res.data;
      } catch (err) {
        return extra.reply(applyFont('❌ Failed to reach the lyrics API. Try again later.', 'bold'));
      }

      if (!data?.status || !Array.isArray(data.result) || data.result.length === 0) {
        return extra.reply(applyFont(`❌ No lyrics found for: *${query}*`, 'bold'));
      }

      if (data.result.length > 1) {
        const sessionId = `lyrics_${extra.from}_${Date.now()}`;

        if (!sock._lyricsSessions) sock._lyricsSessions = {};
        sock._lyricsSessions[sessionId] = data.result.slice(0, 5);

        const buttons = data.result.slice(0, 5).map((item, i) => ({
          body: `${i + 1}. ${item.song} — ${item.artist}`,
          id: `${sessionId}_pick_${i}`
        }));

        await sendButtons(
          sock,
          extra.from,
          {
            image: { url: data.result[0].thumbnail },
            caption: applyFont(`🎵 Found *${data.result.length}* results for: *${query}*\n\nPick a song to view lyrics:`, 'sans'),
            footer: 'JuneX • Lyrics'
          },
          buttons,
          msg
        );

        sock.ev.on('messages.upsert', async ({ messages }) => {
          for (const m of messages) {
            const body =
              m?.message?.buttonsResponseMessage?.selectedButtonId ||
              m?.message?.templateButtonReplyMessage?.selectedId ||
              m?.message?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;

            if (!body || !body.startsWith(sessionId)) continue;

            const idx = parseInt(body.split('_pick_')[1]);
            const sessions = sock._lyricsSessions?.[sessionId];
            if (!sessions || isNaN(idx)) continue;

            const chosen = sessions[idx];
            if (!chosen) continue;

            delete sock._lyricsSessions[sessionId];

            await sendLyrics(sock, m, extra.from, chosen);
          }
        });

      } else {
        await sendLyrics(sock, msg, extra.from, data.result[0]);
      }
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
