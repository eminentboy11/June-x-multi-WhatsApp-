/**
 * Sticker Command — Fixed
 * Properly handles quoted images, videos, and GIFs
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const crypto = require('crypto');
const webp = require('node-webpmux');
const ffmpegPath = require('ffmpeg-static');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const config = require('../../config');
const { getTempDir, deleteTempFile } = require('../../utils/tempManager');

const MAX_FILE_SIZE = 50 * 1024 * 1024;

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Extract media message object from any message wrapper.
 * Checks all known media types.
 */
function extractMedia(messageObj) {
  if (!messageObj) return null;
  return (
    messageObj.imageMessage    ||
    messageObj.videoMessage    ||
    messageObj.stickerMessage  ||
    messageObj.gifMessage      ||
    // documents only if they are image/video mime
    (messageObj.documentMessage &&
      /^(image|video)/.test(messageObj.documentMessage.mimetype || '')
        ? messageObj.documentMessage
        : null)
  );
}

/**
 * Pull contextInfo from wherever it may live in the message.
 * Covers: text replies, image-caption replies, video-caption replies.
 */
function getContextInfo(msg) {
  const m = msg.message;
  if (!m) return null;
  return (
    m.extendedTextMessage?.contextInfo ||
    m.imageMessage?.contextInfo        ||
    m.videoMessage?.contextInfo        ||
    m.documentMessage?.contextInfo     ||
    m.stickerMessage?.contextInfo      ||
    null
  );
}

/**
 * Determine if the media should be treated as animated.
 * Video messages are ALWAYS animated. GIF mimetype = animated.
 */
function isAnimatedMedia(messageObj, mediaMessage) {
  if (!messageObj || !mediaMessage) return false;
  // Explicit video message type → always animated
  if (messageObj.videoMessage) return true;
  // GIF mimetype
  if (mediaMessage.mimetype?.includes('gif')) return true;
  // gifPlayback flag (some clients set this)
  if (mediaMessage.gifPlayback) return true;
  // Fallback: has duration
  if ((mediaMessage.seconds || 0) > 0) return true;
  return false;
}

const execPromise = (cmd) =>
  new Promise((resolve, reject) =>
    exec(cmd, { maxBuffer: 50 * 1024 * 1024 }, (err) =>
      err ? reject(err) : resolve()
    )
  );

// ── Command ────────────────────────────────────────────────────────

module.exports = {
  name: 'sticker',
  aliases: ['s', 'stiker', 'stc'],
  description: 'Convert image or video to sticker (auto compression)',
  usage: '.sticker (reply to media, or send media with caption .sticker)',
  category: 'general',

  async execute(sock, msg, args, extra) {
    const chatId = extra.from;
    const tempDir = getTempDir();
    const timestamp = Date.now();
    const tempInput  = path.join(tempDir, `stk_in_${timestamp}`);
    const tempOutput = path.join(tempDir, `stk_out_${timestamp}.webp`);
    const tempFiles  = [tempInput, tempOutput];

    try {
      // ── 1. Resolve target message ─────────────────────────────
      let targetMessage = msg;

      const ctxInfo = getContextInfo(msg);
      if (ctxInfo?.quotedMessage) {
        targetMessage = {
          key: {
            remoteJid: chatId,
            id:        ctxInfo.stanzaId,
            // FIX: fromMe must be set so downloadMediaMessage works
            fromMe:    ctxInfo.participant === sock.user?.id ||
                       ctxInfo.participant === sock.user?.lid,
            participant: ctxInfo.participant || chatId,
          },
          message: ctxInfo.quotedMessage,
        };
      }

      // ── 2. Find media in target message ───────────────────────
      const mediaMessage = extractMedia(targetMessage.message);

      if (!mediaMessage) {
        return extra.reply(
          '📎 Reply to an *image* or *video* with `.sticker`\n' +
          'or send media with `.sticker` as caption.'
        );
      }

      // ── 3. Download ───────────────────────────────────────────
      await extra.reply('⏳ Creating sticker...');

      let mediaBuffer;
      try {
        mediaBuffer = await downloadMediaMessage(
          targetMessage,
          'buffer',
          {},
          {
            logger: undefined,
            reuploadRequest: sock.updateMediaMessage,
          }
        );
      } catch (dlErr) {
        console.error('[sticker] downloadMediaMessage failed:', dlErr.message);
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

      // ── 4. Determine animation ────────────────────────────────
      const animated = isAnimatedMedia(targetMessage.message, mediaMessage);

      // ── 5. Build ffmpeg command ───────────────────────────────
      const scaleFilter =
        'scale=512:512:force_original_aspect_ratio=decrease,' +
        'pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000';

      const baseCmd = animated
        ? `"${ffmpegPath}" -y -i "${tempInput}" ` +
          `-vf "${scaleFilter},fps=15" ` +
          `-c:v libwebp -preset default -loop 0 -vsync 0 ` +
          `-pix_fmt yuva420p -quality 75 -compression_level 6 "${tempOutput}"`
        : `"${ffmpegPath}" -y -i "${tempInput}" ` +
          `-vf "${scaleFilter},format=rgba" ` +
          `-c:v libwebp -preset default -loop 0 -vsync 0 ` +
          `-pix_fmt yuva420p -quality 75 -compression_level 6 "${tempOutput}"`;

      await execPromise(baseCmd);

      // ── 6. Compression fallback for large animated stickers ───
      let webpBuffer = fs.readFileSync(tempOutput);

      if (animated && webpBuffer.length > 1000 * 1024) {
        const tempOutput2 = path.join(tempDir, `stk_fallback_${timestamp}.webp`);
        tempFiles.push(tempOutput2);

        const isLarge = mediaBuffer.length > 5 * 1024 * 1024;
        const fallbackCmd = isLarge
          ? `"${ffmpegPath}" -y -i "${tempInput}" -t 2 ` +
            `-vf "${scaleFilter},fps=8" ` +
            `-c:v libwebp -preset default -loop 0 -vsync 0 ` +
            `-pix_fmt yuva420p -quality 30 -compression_level 6 ` +
            `-b:v 100k -max_muxing_queue_size 1024 "${tempOutput2}"`
          : `"${ffmpegPath}" -y -i "${tempInput}" -t 3 ` +
            `-vf "${scaleFilter},fps=12" ` +
            `-c:v libwebp -preset default -loop 0 -vsync 0 ` +
            `-pix_fmt yuva420p -quality 45 -compression_level 6 ` +
            `-b:v 150k -max_muxing_queue_size 1024 "${tempOutput2}"`;

        await execPromise(fallbackCmd);
        if (fs.existsSync(tempOutput2)) {
          webpBuffer = fs.readFileSync(tempOutput2);
        }
      }

      // ── 7. Inject EXIF metadata (packname) ────────────────────
      const img = new webp.Image();
      await img.load(webpBuffer);

      const json = {
        'sticker-pack-id':   crypto.randomBytes(32).toString('hex'),
        'sticker-pack-name': config.packname || 'LIGHT-MD',
        'sticker-pack-publisher': config.packpublisher || '',
        emojis: ['🤖'],
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

      // ── 8. Send ───────────────────────────────────────────────
      await sock.sendMessage(chatId, { sticker: finalBuffer }, { quoted: msg });

    } catch (error) {
      console.error('[sticker] Error:', error);

      let friendly = '❌ Failed to create sticker.';
      if (error.message?.includes('ffmpeg') || error.message?.includes('codec')) {
        friendly = '❌ Could not process this media format.';
      } else if (error.message?.includes('webp') || error.message?.includes('load')) {
        friendly = '❌ WebP conversion failed. Media may be corrupted.';
      }

      await extra.reply(friendly);

    } finally {
      tempFiles.forEach(f => deleteTempFile(f));
    }
  },
};
