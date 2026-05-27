const axios = require('axios');
const yts = require('yt-search');
const { sendButtons } = require('gifted-btns');

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractButtonResponseId(msg) {
  const raw =
    msg.message?.buttonsResponseMessage?.selectedButtonId ||
    msg.message?.templateButtonReplyMessage?.selectedId ||
    msg.message?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson ||
    null;

  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    return parsed.id || raw;
  } catch {
    return raw;
  }
}

function getPlayButtons(videoId, dateNow) {
  return [
    { buttonId: `play_audio_${videoId}_${dateNow}`, buttonText: { displayText: '🎵 Audio MP3' } },
    { buttonId: `play_audiodoc_${videoId}_${dateNow}`, buttonText: { displayText: '📄 Audio Document' } },
    { buttonId: `play_video_${videoId}_${dateNow}`, buttonText: { displayText: '🎬 Video MP4' } },
    { buttonId: `play_videodoc_${videoId}_${dateNow}`, buttonText: { displayText: '📁 Video Document' } },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  name: 'play',
  aliases: ['song', 'yt'],
  category: 'media',
  description: 'Search and download YouTube audio or video',
  usage: '.play <song name>',

  async execute(sock, msg, args, extra) {
    const chatId         = extra.from;
    const originalSender = msg.key?.participant || msg.key?.remoteJid;

    try {
      const query = args.join(' ').trim();

      if (!query) {
        return extra.reply(
          `🎵 *Play Downloader*\n\n` +
          `*Usage:* .play <song name>\n` +
          `*Example:* .play Not Like Us`
        );
      }

      await sock.sendMessage(chatId, { react: { text: '🔍', key: msg.key } });

      // ── Step 1: Search YouTube titles/links via yt-search ─────────────────
      const searchResults = await yts(query);
      const videos = searchResults.videos.slice(0, 1); // top 1 result for simplicity

      if (!videos.length) {
        return extra.reply('❌ No results found.');
      }

      const res      = videos[0];
      const dateNow  = Date.now();
      const videoId  = res.videoId || String(dateNow);
      const ytUrl    = res.url;

      // ── Step 2: Fetch audio info from ytplayv2 ────────────────────────────
      const { data } = await axios.get(
        `https://api.drexapp.space/downloader/ytplayv2?q=${encodeURIComponent(query)}`,
        { timeout: 30000 }
      );

      if (!data.status || !data.result) {
        return extra.reply('❌ Failed to fetch media. Try again later.');
      }

      const audioUrl = data.result.downloadURL || null;

      // ── Step 3: Send format selection buttons ─────────────────────────────
      await sendButtons(sock, chatId, {
        title:   '🎵 PLAY DOWNLOADER',
        body:
          `⿻ *Title:*    ${res.title    || 'N/A'}\n` +
          `⿻ *Duration:* ${res.timestamp || 'N/A'}\n` +
          `⿻ *Channel:*  ${res.author?.name || 'N/A'}\n` +
          `⿻ *Views:*    ${res.views?.toLocaleString() ?? 'N/A'}\n\n` +
          `*Select download format:*`,
        footer:  `Made by Supreme`,
        buttons: getPlayButtons(videoId, dateNow),
      }, { quoted: msg });

      await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });

      // ── Step 4: Handle button response ────────────────────────────────────
      const handleResponse = async (event) => {
        const messageData = event.messages?.[0];
        if (!messageData?.message) return;

        const selectedButtonId = extractButtonResponseId(messageData);
        if (!selectedButtonId) return;

        if (!selectedButtonId.includes(`_${dateNow}`)) return;
        if (messageData.key?.remoteJid !== chatId) return;

        const responseSender = messageData.key?.participant || messageData.key?.remoteJid;
        if (responseSender !== originalSender) return;

        sock.ev.off('messages.upsert', handleResponse);

        await sock.sendMessage(chatId, { react: { text: '⬇️', key: msg.key } });

        try {
          const buttonType = selectedButtonId.split('_')[1]; // audio | audiodoc | video | videodoc

          const cleanTitle = (res.title || 'media')
            .replace(/[^\w\s.-]/gi, '')
            .substring(0, 100)
            .trim();

          if (buttonType === 'audio') {
            if (!audioUrl) throw new Error('Audio URL not available');
            await sock.sendMessage(chatId, {
              audio:    { url: audioUrl },
              mimetype: 'audio/mpeg',
            }, { quoted: messageData });

          } else if (buttonType === 'audiodoc') {
            if (!audioUrl) throw new Error('Audio URL not available');
            await sock.sendMessage(chatId, {
              document: { url: audioUrl },
              mimetype: 'audio/mpeg',
              fileName: `${cleanTitle}.mp3`,
            }, { quoted: messageData });

          } else if (buttonType === 'video') {
            await sock.sendMessage(chatId, { text: `_⏳ Processing video..._` }, { quoted: messageData });
            const { data: vidData } = await axios.get(
              `https://api.drexapp.space/downloader/ytmp4?url=${encodeURIComponent(ytUrl)}`,
              { timeout: 60000 }
            );
            if (!vidData.status || !vidData.result?.downloadURL) throw new Error('Video URL not available');
            await sock.sendMessage(chatId, {
              video:    { url: vidData.result.downloadURL },
              mimetype: 'video/mp4',
              caption:  `🎬 *${res.title || ''}*`,
            }, { quoted: messageData });

          } else if (buttonType === 'videodoc') {
            await sock.sendMessage(chatId, { text: `_⏳ Processing video..._` }, { quoted: messageData });
            const { data: vidData } = await axios.get(
              `https://api.drexapp.space/downloader/ytmp4?url=${encodeURIComponent(ytUrl)}`,
              { timeout: 60000 }
            );
            if (!vidData.status || !vidData.result?.downloadURL) throw new Error('Video URL not available');
            await sock.sendMessage(chatId, {
              document: { url: vidData.result.downloadURL },
              mimetype: 'video/mp4',
              fileName: `${cleanTitle}.mp4`,
            }, { quoted: messageData });
          }

          await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });

        } catch (err) {
          console.error('[play] download error:', err.message);
          await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } });
          await sock.sendMessage(chatId, {
            text: `🚫 Download failed: ${err.message}\n\n_Try again later._`,
          }, { quoted: messageData });
        }
      };

      sock.ev.on('messages.upsert', handleResponse);

      setTimeout(() => {
        sock.ev.off('messages.upsert', handleResponse);
      }, 5 * 60 * 1000);

    } catch (err) {
      console.error('[play] error:', err.message);
      await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } });
      extra.reply(`❌ Error: ${err.message}`);
    }
  }
};
