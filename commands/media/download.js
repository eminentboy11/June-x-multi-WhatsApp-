/**
 * Song Command — Audio + Video downloader
 * Audio  : GiftedTech primary → DrexApp fallback
 * Video  : apiskeith.top primary → iamtkm fallback
 *
 * Button flow (mirrors Spotify command pattern):
 *   Stage 1 → 🎵 Audio  |  🎬 Video  (2 buttons)
 *   Stage 2a → Audio MP3 | Audio Doc | Voice Note  (3 buttons, audio path)
 *   Stage 2b → Video MP4 | Video Doc               (2 buttons, video path)
 */

const yts    = require('yt-search');
const axios  = require('axios');
const fs     = require('fs');
const path   = require('path');
const { sendButtons } = require('gifted-btns');
const config = require('../../config');

const RETRY_DELAY = 3000;
const TEMP_DIR    = path.join(__dirname, '../../temp');

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// ── Extract button ID from any Baileys response type ─────────────────────────
function extractButtonResponseId(msg) {
  return (
    msg.message?.buttonsResponseMessage?.selectedButtonId ||
    msg.message?.templateButtonReplyMessage?.selectedId   ||
    msg.message?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson ||
    null
  );
}

function getResponseSender(msg) {
  return msg.key?.participant || msg.key?.remoteJid;
}

// ── Retry wrapper ─────────────────────────────────────────────────────────────
async function withRetry(fn, retries = 3, delayMs = RETRY_DELAY) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const isBusy =
        e.message?.toLowerCase().includes('busy') ||
        e.message?.toLowerCase().includes('try again');
      if (i < retries - 1 && isBusy) {
        await new Promise(r => setTimeout(r, delayMs));
      } else if (!isBusy) {
        throw e;
      }
    }
  }
  throw lastErr;
}

// ── YouTube search ────────────────────────────────────────────────────────────
async function searchYouTube(query) {
  return withRetry(async () => {
    const result = await yts(`${query} official`);
    if (!result?.videos?.length) throw new Error('No results found');
    return result.videos[0];
  });
}

// ── Audio download: GiftedTech → DrexApp fallback ─────────────────────────────
async function downloadAudio(videoUrl) {
  return withRetry(async () => {
    try {
      const primary = await axios.get(
        `https://mcow.giftedtechnexus.workers.dev/api/yta?url=${encodeURIComponent(videoUrl)}`,
        { timeout: 60000 }
      );
      if (primary.data?.success && primary.data?.result?.download_url) {
        return {
          url:   primary.data.result.download_url,
          title: primary.data.result.title,
        };
      }
      throw new Error('Primary audio API failed');
    } catch (err) {
      console.warn('[song] audio primary failed, trying fallback:', err.message);

      const fallback = await axios.get(
        `https://apis.xwolf.space/download/yta?url=${encodeURIComponent(videoUrl)}`,
        { timeout: 60000 }
      );
      if (!fallback.data?.status || !fallback.data?.downloadUrl) {
        throw new Error('Audio fallback API also failed');
      }
      return {
        url:   fallback.data.downloadUrl,
        title: fallback.data.title,
      };
    }
  });
}

// ── Video download: apiskeith → iamtkm fallback ───────────────────────────────
async function downloadVideo(videoUrl) {
  return withRetry(async () => {
    try {
      const primary = await axios.get(
        `https://apiskeith.top/download/video?url=${encodeURIComponent(videoUrl)}`,
        { timeout: 60000 }
      );
      if (primary.data?.status && primary.data?.result) {
        return {
          url:   primary.data.result,
          title: primary.data.title,
        };
      }
      throw new Error('Primary video API failed');
    } catch (err) {
      console.warn('[song] video primary failed, trying fallback:', err.message);

      const fallback = await axios.get(
        `https://iamtkm.vercel.app/downloaders/ytmp4?apikey=tkm&url=${encodeURIComponent(videoUrl)}`,
        { timeout: 60000 }
      );
      if (!fallback.data?.data?.url) {
        throw new Error('Video fallback API also failed');
      }
      return {
        url:   fallback.data.data.url,
        title: fallback.data.data.title,
      };
    }
  });
}

// ── Stream URL to temp file ───────────────────────────────────────────────────
async function streamToFile(url, filePath) {
  const response = await axios({
    method:       'get',
    url,
    responseType: 'stream',
    timeout:      600000,
  });

  const writer = fs.createWriteStream(filePath);
  response.data.pipe(writer);

  await new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error',  reject);
  });

  if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
    throw new Error('Downloaded file is empty or missing');
  }
}

// ── Cleanup temp file safely ──────────────────────────────────────────────────
function cleanUp(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {}
}

// ── Stage 1 buttons: Audio or Video (max 2) ───────────────────────────────────
function getTypeButtons(dateNow) {
  const prefix = config.prefix || '.';
  return [
    { id: `${prefix}songtype_audio_${dateNow}`, text: '🎵 Audio'    },
    { id: `${prefix}songtype_video_${dateNow}`, text: '🎬 Video'    },
  ];
}

// ── Stage 2a buttons: Audio formats (max 3) ───────────────────────────────────
function getAudioFormatButtons(dateNow) {
  const prefix = config.prefix || '.';
  return [
    { id: `${prefix}songfmt_audio_${dateNow}`,     text: '🎵 Audio MP3'      },
    { id: `${prefix}songfmt_audiodoc_${dateNow}`,  text: '📄 Audio Document' },
    { id: `${prefix}songfmt_voicenote_${dateNow}`, text: '🎙️ Voice Note'     },
  ];
}

// ── Stage 2b buttons: Video formats (max 2) ───────────────────────────────────
function getVideoFormatButtons(dateNow) {
  const prefix = config.prefix || '.';
  return [
    { id: `${prefix}songfmt_video_${dateNow}`,    text: '🎬 Video MP4'      },
    { id: `${prefix}songfmt_videodoc_${dateNow}`, text: '📁 Video Document' },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  name: 'song3',
  aliases: ['play3', 'mp3dl', 'mp4dl', 'yt3dl', 'ytmp3dl', 'ytmp4dl'],
  category: 'media',
  description: 'Search and download YouTube audio or video',
  usage: '.song <title>',

  async execute(sock, msg, args, extra) {
    const from           = extra.from;
    const prefix         = config.prefix || '.';
    const originalSender = msg.key?.participant || msg.key?.remoteJid;

    // ── Resolve query ──────────────────────────────────────────────────────
    let query = args.join(' ').trim();
    if (!query) {
      const q = extra?.quoted;
      query   = q?.conversation || q?.extendedTextMessage?.text || '';
    }

    if (!query) {
      return extra.reply(
        `🎵 *Media Downloader*\n\n` +
        `*Usage:* .song <title>\n` +
        `*Example:* .song Not Like Us\n\n` +
        `_Supports: Audio · Audio Doc · Voice Note · Video · Video Doc_`
      );
    }

    if (query.length > 100) {
      return extra.reply('📝 Title too long. Max 100 characters.');
    }

    await sock.sendMessage(from, { react: { text: '🔍', key: msg.key } });

    // ── Step 1: search YouTube ─────────────────────────────────────────────
    let video;
    try {
      video = await searchYouTube(query);
    } catch (e) {
      console.error('[song] search error:', e.message);
      await sock.sendMessage(from, { react: { text: '❌', key: msg.key } });
      return extra.reply(`❌ Search failed: ${e.message}`);
    }

    const dateNow    = Date.now();
    const cleanTitle = (video.title || 'media')
      .replace(/[^\w\s.-]/gi, '')
      .substring(0, 100)
      .trim();

    // ── Step 2: send Stage 1 buttons (Audio / Video) ───────────────────────
    await sendButtons(sock, from, {
      title:   '🎵 MEDIA DOWNLOADER',
      text:
        `⿻ *Title:*    ${video.title}\n` +
        `⿻ *Duration:* ${video.timestamp        || 'N/A'}\n` +
        `⿻ *Views:*    ${video.views?.toLocaleString() ?? 'N/A'}\n` +
        `⿻ *Channel:*  ${video.author?.name     || 'N/A'}\n` +
        `⿻ *Link:*     ${video.url}\n\n` +
        `*Select media type:*`,
      footer:  `Made by ${config.botName || 'Supreme'}`,
      buttons: getTypeButtons(dateNow),
    }, { quoted: msg });

    await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });

    // ── Step 3: listen for Stage 1 (type selection) ────────────────────────
    const handleTypeSelect = async (event) => {
      const messageData = event.messages?.[0];
      if (!messageData?.message) return;

      const selectedId = extractButtonResponseId(messageData);
      if (!selectedId)                                          return;
      if (!selectedId.includes('songtype_'))                    return;
      if (!selectedId.includes(`_${dateNow}`))                  return;
      if (messageData.key?.remoteJid !== from)                  return;

      const responseSender = getResponseSender(messageData);
      if (from.endsWith('@g.us') && responseSender !== originalSender) return;

      // e.g. ".songtype_audio_123" → strip prefix → "songtype_audio_123" → split → "audio"
      const mediaType = selectedId.replace(prefix, '').split('_')[1]; // "audio" | "video"
      if (mediaType !== 'audio' && mediaType !== 'video') return;

      // ── Step 4: send Stage 2 format buttons ───────────────────────────
      const fmtDateNow = Date.now();

      await sendButtons(sock, from, {
        title:   mediaType === 'audio' ? '🎵 AUDIO FORMATS' : '🎬 VIDEO FORMATS',
        text:
          `⿻ *Title:*    ${video.title}\n` +
          `⿻ *Duration:* ${video.timestamp    || 'N/A'}\n` +
          `⿻ *Channel:*  ${video.author?.name || 'N/A'}\n\n` +
          `*Select download format:*`,
        footer:  `Made by ${config.botName || 'Supreme'}`,
        buttons: mediaType === 'audio'
          ? getAudioFormatButtons(fmtDateNow)
          : getVideoFormatButtons(fmtDateNow),
      }, { quoted: messageData });

      await sock.sendMessage(from, { react: { text: '⬇️', key: msg.key } });

      // ── Step 5: listen for Stage 2 (format selection) ─────────────────
      const handleFormatSelect = async (fmtEvent) => {
        const fmtMsg = fmtEvent.messages?.[0];
        if (!fmtMsg?.message) return;

        const fmtId = extractButtonResponseId(fmtMsg);
        if (!fmtId)                                    return;
        if (!fmtId.includes('songfmt_'))               return;
        if (!fmtId.includes(`_${fmtDateNow}`))         return;
        if (fmtMsg.key?.remoteJid !== from)            return;

        const fmtSender = getResponseSender(fmtMsg);
        if (from.endsWith('@g.us') && fmtSender !== originalSender) return;

        // e.g. ".songfmt_audiodoc_123" → strip prefix → split → "audiodoc"
        const formatType = fmtId.replace(prefix, '').split('_')[1];
        // "audio" | "audiodoc" | "voicenote" | "video" | "videodoc"

        const VALID = ['audio', 'audiodoc', 'voicenote', 'video', 'videodoc'];
        if (!VALID.includes(formatType)) return;

        await sock.sendMessage(from, { react: { text: '⏬', key: msg.key } });

        let filePath;

        try {
          // ── 🎵 Audio MP3 ───────────────────────────────────────────────
          if (formatType === 'audio') {
            const data = await downloadAudio(video.url);
            filePath   = path.join(TEMP_DIR, `audio_${fmtDateNow}.mp3`);
            await streamToFile(data.url, filePath);

            await sock.sendMessage(from, {
              audio:    fs.readFileSync(filePath),
              mimetype: 'audio/mpeg',
            }, { quoted: fmtMsg });

          // ── 📄 Audio Document ──────────────────────────────────────────
          } else if (formatType === 'audiodoc') {
            const data = await downloadAudio(video.url);
            filePath   = path.join(TEMP_DIR, `audiodoc_${fmtDateNow}.mp3`);
            await streamToFile(data.url, filePath);

            await sock.sendMessage(from, {
              document: fs.readFileSync(filePath),
              mimetype: 'audio/mpeg',
              fileName: `${cleanTitle}.mp3`,
            }, { quoted: fmtMsg });

          // ── 🎙️ Voice Note ──────────────────────────────────────────────
          } else if (formatType === 'voicenote') {
            const data = await downloadAudio(video.url);
            filePath   = path.join(TEMP_DIR, `vn_${fmtDateNow}.mp3`);
            await streamToFile(data.url, filePath);

            await sock.sendMessage(from, {
              audio:    fs.readFileSync(filePath),
              mimetype: 'audio/ogg; codecs=opus',
              ptt:      true,
            }, { quoted: fmtMsg });

          // ── 🎬 Video MP4 ───────────────────────────────────────────────
          } else if (formatType === 'video') {
            await sock.sendMessage(from, {
              text: `_⏳ Downloading video... please wait._`,
            }, { quoted: fmtMsg });

            const data = await downloadVideo(video.url);
            filePath   = path.join(TEMP_DIR, `video_${fmtDateNow}.mp4`);
            await streamToFile(data.url, filePath);

            await sock.sendMessage(from, {
              video:    fs.readFileSync(filePath),
              mimetype: 'video/mp4',
              caption:  `🎬 *${video.title || ''}*`,
            }, { quoted: fmtMsg });

          // ── 📁 Video Document ──────────────────────────────────────────
          } else if (formatType === 'videodoc') {
            await sock.sendMessage(from, {
              text: `_⏳ Downloading video... please wait._`,
            }, { quoted: fmtMsg });

            const data = await downloadVideo(video.url);
            filePath   = path.join(TEMP_DIR, `videodoc_${fmtDateNow}.mp4`);
            await streamToFile(data.url, filePath);

            await sock.sendMessage(from, {
              document: fs.readFileSync(filePath),
              mimetype: 'video/mp4',
              fileName: `${cleanTitle}.mp4`,
            }, { quoted: fmtMsg });
          }

          await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });

        } catch (error) {
          console.error('[song] download error:', error.message);
          await sock.sendMessage(from, { react: { text: '❌', key: msg.key } });
          await sock.sendMessage(from, {
            text: `🚫 *Download failed*\n\n_${error.message}_\n\n_Try again later._`,
          }, { quoted: fmtMsg });

        } finally {
          cleanUp(filePath);
        }
      };

      // Persistent format listener — allows re-downloading in different formats
      sock.ev.on('messages.upsert', handleFormatSelect);
    };

    // Persistent type listener — allows switching between audio/video
    sock.ev.on('messages.upsert', handleTypeSelect);
  },
};
