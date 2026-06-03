/**
 * Crop Command — Fixed
 * Crop any sticker/image/video into a perfect square sticker (animated for videos)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const ffmpegPath = require('ffmpeg-static');
const webp = require('node-webpmux');
const config = require('../../config');
const { getTempDir, deleteTempFile } = require('../../utils/tempManager');

const MAX_FILE_SIZE = 50 * 1024 * 1024;

// ── Helpers (same pattern as fixed sticker.js) ─────────────────────

/**
 * Extract media from any message wrapper.
 * Returns { type, media } or null.
 */
function extractMedia(messageObj) {
  if (!messageObj) return null;
  const allowed = ['imageMessage', 'videoMessage', 'stickerMessage', 'gifMessage'];
  for (const type of allowed) {
    if (messageObj[type]) return { type, media: messageObj[type] };
  }
  // documentMessage only if image/video mime
  if (messageObj.documentMessage &&
      /^(image|video)/.test(messageObj.documentMessage.mimetype || '')) {
    return { type: 'documentMessage', media: messageObj.documentMessage };
  }
  return null;
}

/**
 * Pull contextInfo from wherever it lives in the message.
 * Covers: text replies, image/video/sticker-caption replies.
 */
function getContextInfo(msg) {
  const m = msg.message;
  if (!m) return null;
  return (
    m.extendedTextMessage?.contextInfo  ||
    m.imageMessage?.contextInfo         ||
    m.videoMessage?.contextInfo         ||
    m.stickerMessage?.contextInfo       ||
    m.documentMessage?.contextInfo      ||
    null
  );
}

/**
 * Determine if media should be treated as animated.
 */
function isAnimatedMedia(messageObj) {
  if (!messageObj) return false;
  if (messageObj.videoMessage)                           return true;
  if (messageObj.imageMessage?.mimetype?.includes('gif')) return true;
  if (messageObj.imageMessage?.gifPlayback)              return true;
  if ((messageObj.stickerMessage?.isAnimated))           return true;
  if ((messageObj.gifMessage))                           return true;
  return false;
}

const execPromise = (cmd) =>
  new Promise((resolve, reject) =>
    exec(cmd, { maxBuffer: 50 * 1024 * 1024 }, (err, _stdout, stderr) => {
      if (err) { err.stderr = stderr; return reject(err); }
      resolve();
    })
  );

// ── Command ────────────────────────────────────────────────────────

module.exports = {
  name: 'crop',
  aliases: ['square', 'cropper'],
  description: 'Crop sticker/image/video to a perfect square sticker',
  usage: '.crop (reply to sticker/image/video)',
  category: 'general',

  async execute(sock, msg, args, extra) {
    const chatId = extra.from;
    const tmpDir  = getTempDir();
    const ts      = Date.now();
    const tempInput  = path.join(tmpDir, `crop_in_${ts}`);
    const tempOutput = path.join(tmpDir, `crop_out_${ts}.webp`);
    const tempFiles  = [tempInput, tempOutput];

    try {
      // ── 1. Resolve target message ─────────────────────────────
      let targetMessage = msg;

      const ctxInfo = getContextInfo(msg);
      if (ctxInfo?.quotedMessage) {
        targetMessage = {
          key: {
            remoteJid:   chatId,
            id:          ctxInfo.stanzaId,
            // FIX: fromMe needed for downloadMediaMessage to pick correct CDN
            fromMe:      ctxInfo.participant === sock.user?.id ||
                         ctxInfo.participant === sock.user?.lid,
            participant: ctxInfo.participant || chatId,
          },
          message: ctxInfo.quotedMessage,
        };
      }

      // ── 2. Find media ─────────────────────────────────────────
      const mediaInfo = extractMedia(targetMessage.message);

      if (!mediaInfo) {
        return extra.reply(
          '✂️ Reply to a *sticker*, *image*, or *video* with `.crop`\n' +
          'or send media with `.crop` as caption.'
        );
      }

      const { type, media: mediaMessage } = mediaInfo;

      // ── 3. Download ───────────────────────────────────────────
      let mediaBuffer;
      try {
        mediaBuffer = await downloadMediaMessage(
          targetMessage,
          'buffer',
          {},
          { logger: undefined, reuploadRequest: sock.updateMediaMessage }
        );
      } catch (dlErr) {
        console.error('[crop] downloadMediaMessage failed:', dlErr.message);
        return extra.reply('❌ Could not download the media. Try forwarding it fresh and retry.');
      }

      if (!mediaBuffer || mediaBuffer.length === 0) {
        return extra.reply('❌ Downloaded media was empty. Please try again.');
      }

      if (mediaBuffer.length > MAX_FILE_SIZE) {
        return extra.reply(
          `❌ File too large: ${(mediaBuffer.length / 1024 / 1024).toFixed(2)} MB (max 50 MB)`
        );
      }

      fs.writeFileSync(tempInput, mediaBuffer);

      // ── 4. Build ffmpeg command ───────────────────────────────
      const animated    = isAnimatedMedia(targetMessage.message);
      const isLargeFile = mediaBuffer.length > 5 * 1024 * 1024;

      // Square-crop filter: crop to smallest dimension, then scale to 512×512
      const cropFilter = 'crop=min(iw\\,ih):min(iw\\,ih),scale=512:512';

      let ffmpegCommand;
      if (animated) {
        if (isLargeFile) {
          ffmpegCommand =
            `"${ffmpegPath}" -y -i "${tempInput}" -t 2 ` +
            `-vf "${cropFilter},fps=8" ` +
            `-c:v libwebp -preset default -loop 0 -vsync 0 ` +
            `-pix_fmt yuva420p -quality 30 -compression_level 6 ` +
            `-b:v 100k -max_muxing_queue_size 1024 "${tempOutput}"`;
        } else {
          ffmpegCommand =
            `"${ffmpegPath}" -y -i "${tempInput}" -t 3 ` +
            `-vf "${cropFilter},fps=12" ` +
            `-c:v libwebp -preset default -loop 0 -vsync 0 ` +
            `-pix_fmt yuva420p -quality 50 -compression_level 6 ` +
            `-b:v 150k -max_muxing_queue_size 1024 "${tempOutput}"`;
        }
      } else {
        ffmpegCommand =
          `"${ffmpegPath}" -y -i "${tempInput}" ` +
          `-vf "${cropFilter},format=rgba" ` +
          `-c:v libwebp -preset default -loop 0 -vsync 0 ` +
          `-pix_fmt yuva420p -quality 75 -compression_level 6 "${tempOutput}"`;
      }

      await execPromise(ffmpegCommand);

      // ── 5. Validate output ────────────────────────────────────
      if (!fs.existsSync(tempOutput) || fs.statSync(tempOutput).size === 0) {
        throw new Error('FFmpeg produced no output file.');
      }

      // ── 6. Inject EXIF metadata ───────────────────────────────
      const webpBuffer = fs.readFileSync(tempOutput);
      const img = new webp.Image();
      await img.load(webpBuffer);

      const json = {
        'sticker-pack-id':        crypto.randomBytes(32).toString('hex'),
        'sticker-pack-name':      config.packname || 'LIGHT-MD',
        'sticker-pack-publisher': config.packpublisher || '',
        emojis: ['✂️'],
      };

      const exifAttr = Buffer.from([
        0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
        0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
      ]);
      const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf8');
      const exif = Buffer.concat([exifAttr, jsonBuffer]);
      exif.writeUIntLE(jsonBuffer.length, 14, 4);

      img.exif = exif;
      const finalBuffer = await img.save(null);

      // ── 7. Send ───────────────────────────────────────────────
      await sock.sendMessage(chatId, { sticker: finalBuffer }, { quoted: msg });

    } catch (error) {
      console.error('[crop] Error:', error);

      let friendly = '❌ Failed to crop. Try with a different image or video.';
      if (error.message?.includes('ffmpeg') || error.stderr) {
        friendly = '❌ Could not process this media format with ffmpeg.';
      } else if (error.message?.includes('webp') || error.message?.includes('load')) {
        friendly = '❌ WebP conversion failed. Media may be corrupted.';
      }

      await extra.reply(friendly);

    } finally {
      tempFiles.forEach(f => deleteTempFile(f));
    }
  },
};
