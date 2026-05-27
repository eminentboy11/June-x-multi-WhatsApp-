const axios = require('axios');
const { sendButtons } = require('gifted-btns');

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractButtonResponseId(msg) {
  const raw =
    msg.message?.buttonsResponseMessage?.selectedButtonId ||
    msg.message?.templateButtonReplyMessage?.selectedId ||
    msg.message?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson ||
    null;

  if (!raw) return null;

  // nativeFlow returns JSON string — extract the id field
  try {
    const parsed = JSON.parse(raw);
    return parsed.id || raw;
  } catch {
    return raw;
  }
}

function getPlayButtons(videoId, dateNow) {
  return [
    { id: `play_audio_${videoId}_${dateNow}`,    text: '🎵 Audio MP3'      },
    { id: `play_audiodoc_${videoId}_${dateNow}`, text: '📄 Audio Document' },
    { id: `play_video_${videoId}_${dateNow}`,    text: '🎬 Video MP4'      },
    { id: `play_videodoc_${videoId}_${dateNow}`, text: '📁 Video Document' },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  name: 'download',
  aliases: ['downld', 'dwnld'],
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

      // ── Fetch from DrexApp ────────────────────────────────────────────────
      const { data } = await axios.get(
        `https://api.drexapp.space/downloader/ytplayv2?q=${encodeURIComponent(query)}`,
        { timeout: 30000 }
      );

      if (!data.status || !data.result) {
        return extra.reply('❌ Failed to fetch media. Try again later.');
      }

      const res     = data.result;
      const dateNow = Date.now();
      const videoId = res.videoId || String(dateNow);

      // ── Send format selection buttons ─────────────────────────────────────
      await sendButtons(sock, chatId, {
        title:   '🎵 PLAY DOWNLOADER',
        body:                                         // gifted-btns uses "body"
          `⿻ *Title:*    ${res.title    || 'N/A'}\n` +
          `⿻ *Duration:* ${res.duration || 'N/A'}\n` +
          `⿻ *Channel:*  ${res.channel  || 'N/A'}\n` +
          `⿻ *Views:*    ${res.views?.toLocaleString() ?? 'N/A'}\n\n` +
          `*Select download format:*`,
        footer:  `Made by Supreme`,
        buttons: getPlayButtons(videoId, dateNow),
      }, { quoted: msg });

      await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });

      // ── Listen for button response ─────────────────────────────────────────
      const handleResponse = async (event) => {
        const messageData = event.messages?.[0];
        if (!messageData?.message) return;

        const selectedButtonId = extractButtonResponseId(messageData);
        if (!selectedButtonId) return;

        // Only this session
        if (!selectedButtonId.includes(`_${dateNow}`)) return;

        // Only this chat
        if (messageData.key?.remoteJid !== chatId) return;

        // Only original sender — silent ignore for everyone else
        const responseSender = messageData.key?.participant || messageData.key?.remoteJid;
        if (responseSender !== originalSender) return;

        // Remove listener — one response per session
        trashcore.ev.off('messages.upsert', handleResponse);

        await sock.sendMessage(chatId, { react: { text: '⬇️', key: msg.key } });

        try {
          // e.g. "play_audio_abc_123" → "audio"
          const buttonType = selectedButtonId.split('_')[1];

          const cleanTitle = (res.title || 'audio')
            .replace(/[^\w\s.-]/gi, '')
            .substring(0, 100)
            .trim();

          // ── 🎵 Audio MP3 ────────────────────────────────────────────────
          if (buttonType === 'audio') {
            await sock.sendMessage(chatId, {
              audio:    { url: res.downloadURL },
              mimetype: 'audio/mpeg',
            }, { quoted: messageData });

          // ── 📄 Audio Document ────────────────────────────────────────────
          } else if (buttonType === 'audiodoc') {
            await sock.sendMessage(chatId, {
              document: { url: res.downloadURL },
              mimetype: 'audio/mpeg',
              fileName: `${cleanTitle}.mp3`,
            }, { quoted: messageData });

          // ── 🎬 Video MP4 ─────────────────────────────────────────────────
          } else if (buttonType === 'video') {
            const videoUrl = res.videoURL || res.downloadURL;
            await sock.sendMessage(chatId, {
              video:    { url: videoUrl },
              mimetype: 'video/mp4',
              caption:  `🎬 *${res.title || ''}*`,
            }, { quoted: messageData });

          // ── 📁 Video Document ────────────────────────────────────────────
          } else if (buttonType === 'videodoc') {
            const videoUrl = res.videoURL || res.downloadURL;
            await sock.sendMessage(chatId, {
              document: { url: videoUrl },
              mimetype: 'video/mp4',
              fileName: `${cleanTitle}.mp4`,
            }, { quoted: messageData });
          }

          await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });

        } catch (err) {
          console.error('[play] download error:', err.message);
          await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } });
          await sock.sendMessage(chatId, {
            text: `🚫 Error: ${err.message}\n\n_Try again later._`,
          }, { quoted: messageData });
        }
      };

      sock.ev.on('messages.upsert', handleResponse);

      // ── Auto-cleanup listener after 5 minutes ────────────────────────────
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
