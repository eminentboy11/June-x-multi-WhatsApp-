/**
 * PTV — Video Note (round/circle video)
 * Reply to a video (or send a video with caption) and convert it to a
 * WhatsApp PTV / video note: square crop, ≤60s, H.264 MP4, sent via ptv:true.
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const ffmpegPath = require('ffmpeg-static');
const { getTempDir, deleteTempFile } = require(require('path').join(global.__CORE__, 'utils', 'tempManager'));

const MAX_DURATION = 60;   // seconds — WhatsApp PTV cap
const SIZE         = 480;  // square edge in pixels

// Probe a video file's duration in seconds via ffmpeg
function probeDuration(filePath) {
  return new Promise((resolve) => {
    execFile(ffmpegPath, ['-i', filePath], (_err, _stdout, stderr) => {
      const m = (stderr || '').match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!m) return resolve(0);
      resolve((+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]));
    });
  });
}

module.exports = {
  name: 'ptv',
  aliases: ['videonote', 'vn', 'tovn', 'tovideonote', 'circlevid'],
  category: 'media',
  description: 'Convert a video to a WhatsApp video note (round/PTV)',
  usage: '.ptv  (reply to a video, gif, or sticker)',

  async execute(sock, msg, _args, extra) {
    const chatId = extra?.from || msg.key.remoteJid;
    const ts     = Date.now();
    const inputFile  = path.join(getTempDir(), `ptv_in_${ts}.tmp`);
    const outputFile = path.join(getTempDir(), `ptv_out_${ts}.mp4`);

    try {
      await sock.sendMessage(chatId, { react: { text: '🎥', key: msg.key } });

      // ── Find the source video ────────────────────────────────────────────
      const ctx       = msg.message?.extendedTextMessage?.contextInfo;
      const quoted    = ctx?.quotedMessage;
      const ownVideo  = msg.message?.videoMessage;
      const quotedVid = quoted?.videoMessage;
      const quotedGif = quotedVid?.gifPlayback ? quotedVid : null;

      const sourceMsg =
        quotedVid ? { key: { remoteJid: ctx.remoteJid || chatId, fromMe: false, id: ctx.stanzaId, participant: ctx.participant }, message: quoted }
        : ownVideo ? msg
        : null;

      if (!sourceMsg) {
        await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } });
        return sock.sendMessage(chatId, {
          text: '❌ Reply to a *video* (or gif) with `.ptv` to convert it to a video note.'
        }, { quoted: msg });
      }

      const buf = await downloadMediaMessage(
        sourceMsg, 'buffer', {},
        { logger: undefined, reuploadRequest: sock.updateMediaMessage }
      );
      if (!buf || buf.length === 0) throw new Error('Failed to download the video.');

      fs.writeFileSync(inputFile, buf);

      // ── Check duration; cap to 60s if longer ─────────────────────────────
      const duration = await probeDuration(inputFile);
      const trimArgs = duration > MAX_DURATION ? ['-t', String(MAX_DURATION)] : [];

      // ── ffmpeg: scale-then-crop to square, H.264, AAC, faststart ──────────
      // The filter:
      //   scale: fit shortest edge to SIZE (preserve aspect, no upscale beyond)
      //   crop:  center-crop to SIZE x SIZE (square)
      const vfilter = `scale=${SIZE}:${SIZE}:force_original_aspect_ratio=increase,crop=${SIZE}:${SIZE}`;

      const ffArgs = [
        '-y',
        '-i', inputFile,
        ...trimArgs,
        '-vf', vfilter,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '28',
        '-pix_fmt', 'yuv420p',
        '-r', '30',
        '-c:a', 'aac',
        '-b:a', '96k',
        '-ac', '2',
        '-ar', '44100',
        '-movflags', '+faststart',
        '-f', 'mp4',
        outputFile,
      ];

      await new Promise((resolve, reject) => {
        execFile(ffmpegPath, ffArgs, (error, _stdout, stderr) => {
          if (error) {
            const tail = (stderr || '').split('\n').slice(-4).join(' ').trim();
            return reject(new Error(`FFmpeg failed: ${tail || error.message}`));
          }
          resolve();
        });
      });

      if (!fs.existsSync(outputFile) || fs.statSync(outputFile).size === 0) {
        throw new Error('Conversion produced an empty file.');
      }

      const outBuf = fs.readFileSync(outputFile);

      // ── Send as WhatsApp PTV (video note) ────────────────────────────────
      await sock.sendMessage(chatId, {
        video: outBuf,
        ptv: true,
        mimetype: 'video/mp4',
      }, { quoted: msg });

      await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });

    } catch (error) {
      console.error('[PTV] Error:', error);
      await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } });
      await sock.sendMessage(chatId, {
        text: `🚫 PTV error: ${error.message}`
      }, { quoted: msg });
    } finally {
      [inputFile, outputFile].forEach(f => {
        try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {}
      });
    }
  },
};
