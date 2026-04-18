/**
 * Write Command
 * Overlay text on images, stickers and animated stickers.
 * Usage: .write <text> [position] — reply to image or sticker
 * Positions: center (default), top, bottom, left, right,
 *            topleft, topright, bottomleft, bottomright
 */

const fs     = require('fs');
const path   = require('path');
const { exec, execSync } = require('child_process');
const crypto = require('crypto');
const webp   = require('node-webpmux');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { getTempDir, deleteTempFile } = require('../../utils/tempManager');
const config = require('../../config');

// Resolve an ffmpeg binary that has the drawtext filter.
// ffmpeg-static ships a build WITHOUT drawtext; the system ffmpeg (on Replit/Heroku)
// usually has it. We try the PATH binary first, then fall back to ffmpeg-static.
function resolveFFmpeg() {
    try {
        const pathBin = execSync('which ffmpeg 2>/dev/null', { encoding: 'utf8' }).trim();
        if (pathBin && fs.existsSync(pathBin)) {
            const filters = execSync(`"${pathBin}" -filters 2>&1`, { encoding: 'utf8' });
            if (filters.includes('drawtext')) return pathBin;
        }
    } catch (_) {}
    // Fallback to ffmpeg-static (drawtext may be unavailable — will error gracefully)
    return require('ffmpeg-static');
}
const ffmpegPath = resolveFFmpeg();

const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

const POSITIONS = {
  center:      'x=(w-text_w)/2:y=(h-text_h)/2',
  top:         'x=(w-text_w)/2:y=30',
  bottom:      'x=(w-text_w)/2:y=h-text_h-30',
  left:        'x=20:y=(h-text_h)/2',
  right:       'x=w-text_w-20:y=(h-text_h)/2',
  topleft:     'x=20:y=20',
  topright:    'x=w-text_w-20:y=20',
  bottomleft:  'x=20:y=h-text_h-30',
  bottomright: 'x=w-text_w-20:y=h-text_h-30',
};

const POSITION_ALIASES = {
  mid: 'center', middle: 'center',
  up: 'top',
  down: 'bottom',
  r: 'right', l: 'left',
};

function execPromise(cmd) {
  return new Promise((resolve, reject) =>
    exec(cmd, { maxBuffer: 50 * 1024 * 1024 }, (err) => (err ? reject(err) : resolve()))
  );
}

async function addExif(buffer) {
  const img = new webp.Image();
  await img.load(buffer);
  const json = {
    'sticker-pack-id':   crypto.randomBytes(32).toString('hex'),
    'sticker-pack-name': config.packname || config.botName,
    emojis: ['✍️'],
  };
  const exifAttr = Buffer.from([
    0x49,0x49,0x2a,0x00,0x08,0x00,0x00,0x00,
    0x01,0x00,0x41,0x57,0x07,0x00,0x00,0x00,
    0x00,0x00,0x16,0x00,0x00,0x00,
  ]);
  const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const exif = Buffer.concat([exifAttr, jsonBuf]);
  exif.writeUIntLE(jsonBuf.length, 14, 4);
  img.exif = exif;
  return img.save(null);
}

module.exports = {
  name: 'write',
  aliases: ['memetext', 'addtext', 'textwrite', 'wrt'],
  category: 'general',
  description: 'Write meme text on stickers or images (static & animated)',
  usage: '.write <text> [center|top|bottom|left|right] — reply to sticker/image',

  async execute(sock, msg, args, extra) {
    const from = extra.from;

    if (!args.length) {
      return extra.reply(
        `✍️ *Write text on stickers / images*\n\n` +
        `*Usage:* .write <text> [position]\n\n` +
        `*Positions:*\n` +
        `• center (default)\n• top  •  bottom\n• left  •  right\n` +
        `• topleft  •  topright\n• bottomleft  •  bottomright\n\n` +
        `*Examples:*\n` +
        `_.write Supreme center_\n` +
        `_.write It's me bottom_\n` +
        `_.write LOL topleft_\n\n` +
        `Reply to an image or sticker.`
      );
    }

    // Parse optional trailing position keyword
    const POSITION_KEYS = Object.keys(POSITIONS);
    let position = 'bottom';
    let textArgs = [...args];
    const lastWord = args[args.length - 1].toLowerCase();
    const resolvedPos = POSITION_ALIASES[lastWord] || (POSITIONS[lastWord] ? lastWord : null);
    if (resolvedPos) {
      position = resolvedPos;
      textArgs = args.slice(0, -1);
    }

    const text = textArgs.join(' ').trim();
    if (!text) return extra.reply('❌ Please provide the text to write.');

    // Resolve quoted message
    const ctxInfo = msg.message?.extendedTextMessage?.contextInfo;
    if (!ctxInfo?.quotedMessage) {
      return extra.reply('❌ Reply to a sticker or image with this command.');
    }

    const qMsg = ctxInfo.quotedMessage;
    const isSticker = !!qMsg.stickerMessage;
    const isImage   = !!qMsg.imageMessage;
    const isVideo   = !!qMsg.videoMessage;

    if (!isSticker && !isImage && !isVideo) {
      return extra.reply('❌ Reply to a sticker or image.');
    }

    await sock.sendMessage(from, { react: { text: '⏳', key: msg.key } });

    const tempDir  = getTempDir();
    const ts       = Date.now();
    const tempIn   = path.join(tempDir, `wrt_in_${ts}`);
    const textFile = path.join(tempDir, `wrt_txt_${ts}.txt`);
    const tempOut  = path.join(tempDir, `wrt_out_${ts}.webp`);
    const tempJpg  = path.join(tempDir, `wrt_out_${ts}.jpg`);
    const tempFiles = [tempIn, textFile, tempOut, tempJpg];

    try {
      const quotedMsg = {
        key: {
          remoteJid: from,
          id: ctxInfo.stanzaId,
          participant: ctxInfo.participant,
        },
        message: qMsg,
      };

      const buffer = await downloadMediaMessage(
        quotedMsg, 'buffer', {},
        { logger: undefined, reuploadRequest: sock.updateMediaMessage }
      );
      if (!buffer) return extra.reply('❌ Failed to download media.');

      fs.writeFileSync(tempIn, buffer);
      // Write text to file to avoid shell-escaping issues
      fs.writeFileSync(textFile, text, 'utf8');

      const posStr = POSITIONS[position];
      const isAnimated = isSticker
        ? (qMsg.stickerMessage?.isAnimated ?? false)
        : isVideo;

      // Build drawtext filter — uses textfile= to avoid special-char escaping
      const dtFilter = [
        `fontfile='${FONT}'`,
        `textfile='${textFile}'`,
        `fontsize=60`,
        `fontcolor=white`,
        `borderw=4`,
        `bordercolor=black`,
        posStr,
      ].join(':');

      if (isSticker || isVideo) {
        // ── Output as WebP sticker ──────────────────────────────────────────
        const scale = 'scale=512:512:force_original_aspect_ratio=decrease';
        const pad   = 'pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000';
        const inputDecodeFlag = isAnimated && isSticker ? '-c:v libwebp' : '';

        const vf = isAnimated
          ? `${scale},fps=15,${pad},drawtext=${dtFilter}`
          : `${scale},format=rgba,${pad},drawtext=${dtFilter}`;

        const ffCmd = `"${ffmpegPath}" -y ${inputDecodeFlag} -i "${tempIn}" -vf "${vf}" -c:v libwebp -preset default -loop 0 -vsync 0 -pix_fmt yuva420p -quality 80 -compression_level 6 "${tempOut}"`;

        await execPromise(ffCmd);

        let webpBuf = fs.readFileSync(tempOut);
        webpBuf = await addExif(webpBuf);
        await sock.sendMessage(from, { sticker: webpBuf }, { quoted: msg });

      } else {
        // ── Image input → output JPEG ───────────────────────────────────────
        const vf = `scale=iw:ih,drawtext=${dtFilter}`;
        const ffCmd = `"${ffmpegPath}" -y -i "${tempIn}" -vf "${vf}" -update 1 -q:v 2 "${tempJpg}"`;

        await execPromise(ffCmd);

        const jpgBuf = fs.readFileSync(tempJpg);
        await sock.sendMessage(from, { image: jpgBuf, caption: `✍️ ${text}` }, { quoted: msg });
      }

      await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });

    } catch (err) {
      console.error('[write] error:', err.message || err);
      await sock.sendMessage(from, { react: { text: '❌', key: msg.key } });
      await extra.reply(`❌ Failed to write text: ${err.message}`);
    } finally {
      tempFiles.forEach(f => deleteTempFile(f));
    }
  },
};
