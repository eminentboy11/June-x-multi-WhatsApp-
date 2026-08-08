/**
 * Take Command
 * Retake/repack an image, short video, or sticker as a JuneX sticker.
 * Sticker pack name is always the sender's WhatsApp display name (pushName).
 */

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const webp = require('node-webpmux');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const config = require('../../config');

let ffmpegPath;
try { ffmpegPath = require('ffmpeg-static'); } catch { ffmpegPath = 'ffmpeg'; }

const STICKER_AUTHOR = config.stickerAuthor || config.author || config.botName || 'JuneX';

async function injectExif(webpBuffer, packname, author) {
  const img = new webp.Image();
  await img.load(webpBuffer);

  const json = {
    'sticker-pack-id': crypto.randomBytes(32).toString('hex'),
    'sticker-pack-name': packname,
    'sticker-pack-publisher': author,
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
  return img.save(null);
}

function toWebpViaFfmpeg(inputPath, isVideo, fps = 10) {
  const outPath = path.join(os.tmpdir(), `take_${Date.now()}.webp`);
  const filter = isVideo
    ? `scale=512:512:force_original_aspect_ratio=decrease,fps=${fps},pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black@0`
    : `scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black@0`;

  const durationFlag = isVideo ? '-t 6' : '';
  const loopFlag = isVideo ? '-loop 0' : '';

  execSync(
    `"${ffmpegPath}" -y -i "${inputPath}" ${durationFlag} -vf "${filter}" ` +
    `-an ${loopFlag} -vcodec libwebp -preset default -qscale 60 "${outPath}"`,
    { timeout: 30000, stdio: 'pipe' }
  );

  const buf = fs.readFileSync(outPath);
  try { fs.unlinkSync(outPath); } catch {}
  return buf;
}

module.exports = [
  {
    name: 'take',
    aliases: ['steal'],
    description: 'Retake/repack an image, short video, or sticker as a JuneX sticker.',
    usage: '.take (reply to image/video/sticker)',
    category: 'general',

    async execute(sock, msg, args, extra) {
      const ctx = msg.message?.extendedTextMessage?.contextInfo;
      const quoted = ctx?.quotedMessage;

      if (!quoted) {
        return extra.reply('❌ Quote an image, a short video, or a sticker to retake it.');
      }

      let mediaType;
      if (quoted.imageMessage) mediaType = 'image';
      else if (quoted.videoMessage) mediaType = 'video';
      else if (quoted.stickerMessage) mediaType = 'sticker';
      else {
        return extra.reply('❌ This is neither a sticker, image, nor a video.');
      }

      await extra.react('⏳');

      const targetMessage = {
        key: {
          remoteJid: extra.from,
          id: ctx.stanzaId,
          participant: ctx.participant,
          fromMe: false,
        },
        message: quoted,
      };

      const packname = msg.pushName || extra.sender.split('@')[0];
      const author = STICKER_AUTHOR;

      let inputPath;
      try {
        const mediaBuffer = await downloadMediaMessage(
          targetMessage,
          'buffer',
          {},
          { logger: undefined, reuploadRequest: sock.updateMediaMessage }
        );

        if (!mediaBuffer) {
          await extra.react('❌');
          return extra.reply('❌ Failed to download media. Please try again.');
        }

        let stickerBuf;

        if (mediaType === 'sticker') {
          stickerBuf = await injectExif(mediaBuffer, packname, author);

        } else {
          inputPath = path.join(os.tmpdir(), `take_in_${Date.now()}`);
          fs.writeFileSync(inputPath, mediaBuffer);

          const isVideo = mediaType === 'video';
          let webpBuf;

          try {
            webpBuf = toWebpViaFfmpeg(inputPath, isVideo, 10);
          } catch (e) {
            console.error('[take] ffmpeg failed', e.message);
            await extra.react('❌');
            return extra.reply('❌ Sticker conversion failed — ffmpeg may be unavailable on this server.');
          }

          if (isVideo && webpBuf.length > 950 * 1024) {
            try {
              webpBuf = toWebpViaFfmpeg(inputPath, true, 5);
            } catch (e) {
              console.error('[take] ffmpeg retry failed', e.message);
            }
          }

          if (webpBuf.length > 1024 * 1024) {
            await extra.react('❌');
            return extra.reply(
              `❌ Sticker still too large (${(webpBuf.length / 1024 / 1024).toFixed(2)} MB) after compression.\n💡 Tip: Try a shorter clip (< 4s) or send an image instead.`
            );
          }

          stickerBuf = await injectExif(webpBuf, packname, author);
        }

        await sock.sendMessage(extra.from, { sticker: stickerBuf }, { quoted: msg });
        await extra.react('✅');

      } catch (error) {
        console.error('[take]', error.message);
        await extra.react('❌');
        await extra.reply('❌ Failed to retake sticker. Please try again.');
      } finally {
        if (inputPath) { try { fs.unlinkSync(inputPath); } catch {} }
      }
    },
  },
];
