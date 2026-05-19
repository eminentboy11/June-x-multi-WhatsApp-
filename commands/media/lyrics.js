/**
 * Lyrics Finder with Next Button
 */

const axios = require('axios');
const { sendButtons } = require('gifted-btns');
const config = require('../../config');

function extractButtonResponseId(msg) {
  return (
    msg.message?.buttonsResponseMessage?.selectedButtonId ||
    msg.message?.templateButtonReplyMessage?.selectedId ||
    msg.message?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson ||
    null
  );
}

function getResponseSender(msg) {
  return msg.key?.participant || msg.key?.remoteJid;
}

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
    const dateNow = Date.now();
    const prefix = config.prefix || '.';
    const originalSender = msg.key.participant || msg.key.remoteJid;

    // ── Fetch multiple results from APIs ────────────────────────────────
    let results = [];

    try {
      const res = await axios.get(
        `https://apiskeith.top/search/lyrics?query=${encodeURIComponent(query)}`,
        { timeout: 10000 }
      );
      if (res.data?.status && Array.isArray(res.data.result)) {
        results = res.data.result.map(r => ({
          title: r.song || 'Unknown Title',
          artist: r.artist || 'Unknown Artist',
          lyrics: r.lyrics || 'No lyrics found',
          thumbnail: r.thumbnail || null
        }));
      }
    } catch (err) {
      console.log('Keith lyrics API failed:', err.message);
    }

    // Fallbacks if no results
    if (results.length === 0) {
      try {
        const res = await axios.get(
          `https://api.vreden.my.id/api/lyrics?query=${encodeURIComponent(query)}`,
          { timeout: 10000 }
        );
        if (res.data?.result) {
          results.push({
            title: res.data.result.title || 'Unknown Title',
            artist: res.data.result.artist || 'Unknown Artist',
            lyrics: res.data.result.lyrics || 'No lyrics found',
            thumbnail: res.data.result.thumbnail || null
          });
        }
      } catch { console.log('Vreden lyrics API failed'); }
    }

    if (results.length === 0) {
      try {
        const res = await axios.get(
          `https://api.siputzx.my.id/api/s/lyrics?query=${encodeURIComponent(query)}`,
          { timeout: 10000 }
        );
        if (res.data?.status && res.data?.data) {
          results.push({
            title: res.data.data.title || 'Unknown Title',
            artist: res.data.data.artist || 'Unknown Artist',
            lyrics: res.data.data.lyrics || 'No lyrics found',
            thumbnail: res.data.data.image || null
          });
        }
      } catch { console.log('Siputzx lyrics API failed'); }
    }

    if (results.length === 0) {
      return await sock.sendMessage(jid, {
        text: '❌ Could not find lyrics for that song. Try a different song name or spelling.'
      });
    }

    // ── Function to send one result with Next button ────────────────────
    const sendLyricsResult = async (index, quotedMsg) => {
      const data = results[index];
      let lyrics = data.lyrics;
      if (lyrics.length > 4000) {
        lyrics = lyrics.substring(0, 4000) + '...\n\n_Lyrics truncated — showing first part only_';
      }

      const caption =
        `🎵 *${data.title}*\n` +
        `👤 *Artist:* ${data.artist}\n\n` +
        `📝 *Lyrics:*\n${lyrics}\n\n` +
        `_Fetched by ${config.botName}_`;

      const buttons = [];
      if (index < results.length - 1) {
        buttons.push({ id: `${prefix}lyricsnext_${index+1}_${dateNow}`, text: '⏭️ Next' });
      }

      await sendButtons(sock, jid, {
        title: `🎶 Lyrics Finder`,
        text: caption,
        footer: `Made by ${config.botName}`,
        buttons
      }, { quoted: quotedMsg || msg });
    };

    // Send first result
    await sendLyricsResult(0);

    // ── Handler for Next button ─────────────────────────────────────────
    const handleResponse = async (event) => {
      const messageData = event.messages[0];
      if (!messageData?.message) return;

      const selectedButtonId = extractButtonResponseId(messageData);
      if (!selectedButtonId) return;
      if (!selectedButtonId.includes(`_${dateNow}`)) return;
      if (messageData.key?.remoteJid !== jid) return;

      const responseSender = getResponseSender(messageData);
      if (jid.endsWith('@g.us') && responseSender !== originalSender) return;

      if (selectedButtonId.startsWith(`${prefix}lyricsnext_`)) {
        const parts = selectedButtonId.split('_');
        const nextIndex = parseInt(parts[1], 10);
        if (!isNaN(nextIndex) && nextIndex < results.length) {
          await sendLyricsResult(nextIndex, messageData);
        }
      }
    };

    sock.ev.on('messages.upsert', handleResponse);
    setTimeout(() => sock.ev.off('messages.upsert', handleResponse), 120000);
  }
};
