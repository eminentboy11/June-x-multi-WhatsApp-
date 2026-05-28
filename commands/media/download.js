/**
 * Song Command — Audio + Video downloader
 * Audio : GiftedTech primary → DrexApp fallback
 * Video : apiskeith.top primary → iamtkm fallback
 */

const yts   = require('yt-search');
const axios = require('axios');
const fs    = require('fs');
const path  = require('path');
const { sendButtons } = require('gifted-btns');
const config = require('../../config');

const RETRY_DELAY = 3000;
const TEMP_DIR    = path.join(__dirname, '../../temp');

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// ── Extract button ID from any Baileys response type ─────────────────────────
function extractButtonResponseId(msg) {
  const raw =
    msg.message?.buttonsResponseMessage?.selectedButtonId   ||
    msg.message?.templateButtonReplyMessage?.selectedId     ||
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

// ── Audio download: GiftedTech → DrexApp fallback ────────────────────────────
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

// ── Video download: apiskeith → iamtkm fallback ──────────────────────────────
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

// ── Stream URL to a temp file ─────────────────────────────────────────────────
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

// ── Delete temp file safely ───────────────────────────────────────────────────
function cleanUp(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {}
}

// ── 5 format buttons ──────────────────────────────────────────────────────────
function getMediaButtons(videoId, dateNow) {
  return [
    { id: `song_audio_${videoId}_${dateNow}`,     text: '🎵 Audio'          },
    { id: `song_audiodoc_${videoId}_${dateNow}`,  text: '📄 Audio Document' },
    { id: `song_voicenote_${videoId}_${dateNow}`, text: '🎙️ Voice Note'     },
    { id: `song_video_${videoId}_${dateNow}`,     text: '🎬 Video MP4'      },
    { id: `song_videodoc_${videoId}_${dateNow}`,  text: '📁 Video Document' },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  name: 'download',
  aliases: ['play3', 'dl', 'song3', 'yt3', 'ytv3', 'ytplay3'],
  category: 'media',
  description: 'Search and download YouTube audio or video',
  usage: '.song <title>',

  async execute(sock, msg, args, extra) {
    const from           = extra.from;
    const originalSender = msg.key?.participant || msg.key?.remoteJid;

    // ── Resolve query ──────────────────────────────────────────────────────
    let query = args.join(' ').trim();
    if (!query) {
      const q = extra?.quoted;
      query = q?.conversation || q?.extendedTextMessage?.text || '';
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

    // ── Step 2: send format buttons ────────────────────────────────────────
    await sendButtons(sock, from, {
      title:   '🎵 MEDIA DOWNLOADER',
      body:
        `⿻ *Title:*    ${video.title}\n` +
        `⿻ *Duration:* ${video.timestamp        || 'N/A'}\n` +
        `⿻ *Views:*    ${video.views?.toLocaleString() ?? 'N/A'}\n` +
        `⿻ *Channel:*  ${video.author?.name     || 'N/A'}\n` +
        `⿻ *Link:*     ${video.url}\n\n` +
        `*Select download format:*`,
      footer:  `Made by ${config.botName || 'Supreme'}`,
      buttons: getMediaButtons(video.videoId, dateNow),
    }, { quoted: msg });

    await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });

    // ── Step 3: listen for button tap ──────────────────────────────────────
    const handleResponse = async (event) => {
      const messageData = event.messages?.[0];
      if (!messageData?.message) return;

      const selectedId = extractButtonResponseId(messageData);
      if (!selectedId)                                    return;
      if (!selectedId.includes(`_${dateNow}`))            return;
      if (messageData.key?.remoteJid !== from)            return;

      // Groups: only original sender; DMs: anyone
      const responseSender = messageData.key?.participant || messageData.key?.remoteJid;
      if (from.endsWith('@g.us') && responseSender !== originalSender) return;

      // song_audio_abc_123     → [song, audio,     abc, 123]
      // song_audiodoc_abc_123  → [song, audiodoc,  abc, 123]
      // song_voicenote_abc_123 → [song, voicenote, abc, 123]
      // song_video_abc_123     → [song, video,     abc, 123]
      // song_videodoc_abc_123  → [song, videodoc,  abc, 123]
      const buttonType = selectedId.split('_')[1];

      const VALID = ['audio', 'audiodoc', 'voicenote', 'video', 'videodoc'];
      if (!VALID.includes(buttonType)) return;

      await sock.sendMessage(from, { react: { text: '⬇️', key: msg.key } });

      let filePath;

      try {
        // ── 🎵 Audio MP3 ────────────────────────────────────────────────
        if (buttonType === 'audio') {
          const data = await downloadAudio(video.url);
          filePath   = path.join(TEMP_DIR, `audio_${dateNow}.mp3`);
          await streamToFile(data.url, filePath);

          await sock.sendMessage(from, {
            audio:    fs.readFileSync(filePath),
            mimetype: 'audio/mpeg',
          }, { quoted: messageData });

        // ── 📄 Audio Document ────────────────────────────────────────────
        } else if (buttonType === 'audiodoc') {
          const data = await downloadAudio(video.url);
          filePath   = path.join(TEMP_DIR, `audiodoc_${dateNow}.mp3`);
          await streamToFile(data.url, filePath);

          await sock.sendMessage(from, {
            document: fs.readFileSync(filePath),
            mimetype: 'audio/mpeg',
            fileName: `${cleanTitle}.mp3`,
          }, { quoted: messageData });

        // ── 🎙️ Voice Note ─────────────────────────────────────────────
        } else if (buttonType === 'voicenote') {
          const data = await downloadAudio(video.url);
          filePath   = path.join(TEMP_DIR, `vn_${dateNow}.mp3`);
          await streamToFile(data.url, filePath);

          await sock.sendMessage(from, {
            audio:    fs.readFileSync(filePath),
            mimetype: 'audio/ogg; codecs=opus',
            ptt:      true,
          }, { quoted: messageData });

        // ── 🎬 Video MP4 ─────────────────────────────────────────────────
        } else if (buttonType === 'video') {
          await sock.sendMessage(from, {
            text: `_⏳ Downloading video... please wait._`,
          }, { quoted: messageData });

          const data = await downloadVideo(video.url);
          filePath   = path.join(TEMP_DIR, `video_${dateNow}.mp4`);
          await streamToFile(data.url, filePath);

          await sock.sendMessage(from, {
            video:    fs.readFileSync(filePath),
            mimetype: 'video/mp4',
            caption:  `🎬 *${video.title || ''}*`,
          }, { quoted: messageData });

        // ── 📁 Video Document ────────────────────────────────────────────
        } else if (buttonType === 'videodoc') {
          await sock.sendMessage(from, {
            text: `_⏳ Downloading video... please wait._`,
          }, { quoted: messageData });

          const data = await downloadVideo(video.url);
          filePath   = path.join(TEMP_DIR, `videodoc_${dateNow}.mp4`);
          await streamToFile(data.url, filePath);

          await sock.sendMessage(from, {
            document: fs.readFileSync(filePath),
            mimetype: 'video/mp4',
            fileName: `${cleanTitle}.mp4`,
          }, { quoted: messageData });
        }

        await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });

      } catch (error) {
        console.error('[song] download error:', error.message);
        await sock.sendMessage(from, { react: { text: '❌', key: msg.key } });
        await sock.sendMessage(from, {
          text: `🚫 *Download failed*\n\n_${error.message}_\n\n_Try again later._`,
        }, { quoted: messageData });

      } finally {
        cleanUp(filePath);
      }
    };

    // Persistent listener — supports repeated taps, no expiry
    sock.ev.on('messages.upsert', handleResponse);
  },
};
