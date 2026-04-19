/**
 * Write Command
 * Overlay text on images, stickers and animated stickers.
 * Usage: .write <text> [position] — reply to image or sticker
 * Positions: center (default), top, bottom, left, right,
 *            topleft, topright, bottomleft, bottomright
 *
 * Static images/stickers  → sharp SVG composite (no system ffmpeg needed)
 * Animated stickers/video → ffmpeg drawtext (searches multiple binary paths)
 */

const fs     = require('fs');
const path   = require('path');
const { exec, execSync } = require('child_process');
const crypto = require('crypto');
const sharp  = require('sharp');
const webp   = require('node-webpmux');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { getTempDir, deleteTempFile } = require('../../utils/tempManager');
const config = require('../../config');

// ─── ffmpeg resolver (used only for animated stickers/video) ────────────────
// Searches several known locations so it works on Replit, Heroku, VPS, etc.
let _ffmpegPath = null;
function resolveFFmpeg() {
    if (_ffmpegPath) return _ffmpegPath;
    const candidates = [];

    // 1. PATH binary
    try {
        const bin = execSync('which ffmpeg 2>/dev/null', { encoding: 'utf8' }).trim();
        if (bin) candidates.push(bin);
    } catch (_) {}

    // 2. Common system paths
    candidates.push('/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg');

    // 3. Nix store (Replit) — use find with maxdepth + timeout to avoid hanging
    try {
        const nixBins = execSync(
            'find /nix/store -maxdepth 3 -name ffmpeg -type f 2>/dev/null | head -5',
            { encoding: 'utf8', timeout: 4000 }
        ).split('\n').filter(Boolean);
        candidates.push(...nixBins);
    } catch (_) {}

    // 4. ffmpeg-static (last resort — may lack drawtext)
    try { candidates.push(require('ffmpeg-static')); } catch (_) {}

    for (const bin of candidates) {
        try {
            if (!bin || !fs.existsSync(bin)) continue;
            const out = execSync(`"${bin}" -filters 2>&1`, { encoding: 'utf8', timeout: 5000 });
            if (out.includes('drawtext')) { _ffmpegPath = bin; return bin; }
        } catch (_) {}
    }
    return null; // no drawtext-capable ffmpeg found
}

// ─── Position helpers ────────────────────────────────────────────────────────
const POSITION_ALIASES = {
    mid: 'center', middle: 'center',
    up: 'top', down: 'bottom',
    r: 'right', l: 'left',
};

// Returns SVG x/y/anchor for a given position and image size
function svgCoords(position, w, h, fontSize, lineCount) {
    const pad = 24;
    const lineH = fontSize * 1.2;
    const totalH = lineH * lineCount;
    const cx = w / 2;
    switch (position) {
        case 'top':         return { x: cx, y: pad + fontSize,           anchor: 'middle' };
        case 'bottom':      return { x: cx, y: h - pad - totalH + fontSize, anchor: 'middle' };
        case 'left':        return { x: pad, y: (h - totalH) / 2 + fontSize, anchor: 'start' };
        case 'right':       return { x: w - pad, y: (h - totalH) / 2 + fontSize, anchor: 'end' };
        case 'topleft':     return { x: pad, y: pad + fontSize,           anchor: 'start' };
        case 'topright':    return { x: w - pad, y: pad + fontSize,       anchor: 'end' };
        case 'bottomleft':  return { x: pad, y: h - pad - totalH + fontSize, anchor: 'start' };
        case 'bottomright': return { x: w - pad, y: h - pad - totalH + fontSize, anchor: 'end' };
        default:            return { x: cx, y: (h - totalH) / 2 + fontSize, anchor: 'middle' }; // center
    }
}

// Wrap text into lines of ≤ maxChars
function wrapText(text, maxChars = 20) {
    const words = text.split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
        if ((cur + (cur ? ' ' : '') + w).length > maxChars) {
            if (cur) lines.push(cur);
            cur = w;
        } else {
            cur = cur ? cur + ' ' + w : w;
        }
    }
    if (cur) lines.push(cur);
    return lines;
}

// Escape XML special chars for SVG text
function xmlEsc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// ─── Sharp-based text overlay (static content) ───────────────────────────────
async function overlayTextSharp(inputBuffer, text, position, outputFormat, outputOptions = {}) {
    const meta = await sharp(inputBuffer).metadata();
    const w = meta.width  || 512;
    const h = meta.height || 512;

    // Auto-scale font size relative to image width
    const fontSize = Math.max(28, Math.min(72, Math.floor(w / 7)));
    const maxChars = Math.max(10, Math.floor(w / (fontSize * 0.55)));
    const lines    = wrapText(text, maxChars);
    const lineH    = fontSize * 1.2;
    const { x, y, anchor } = svgCoords(position, w, h, fontSize, lines.length);

    // Build tspan elements for multi-line
    const tspans = lines.map((line, i) => {
        const dy = i === 0 ? 0 : lineH;
        return `<tspan x="${x}" dy="${dy}">${xmlEsc(line)}</tspan>`;
    }).join('');

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <text
    x="${x}" y="${y}"
    text-anchor="${anchor}"
    font-family="DejaVu Sans Bold, Arial Bold, sans-serif"
    font-size="${fontSize}"
    font-weight="bold"
    fill="white"
    stroke="black"
    stroke-width="${Math.max(2, Math.round(fontSize / 14))}"
    paint-order="stroke"
  >${tspans}</text>
</svg>`;

    let pipeline = sharp(inputBuffer).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]);

    if (outputFormat === 'webp') {
        pipeline = pipeline.webp({ quality: 85, ...outputOptions });
    } else {
        pipeline = pipeline.jpeg({ quality: 88, ...outputOptions });
    }
    return pipeline.toBuffer();
}

// ─── ffmpeg-based text overlay (animated) ────────────────────────────────────
function ffmpegDrawtext(ffmpegBin, inputPath, outputPath, text, position, isAnimated, textFile) {
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
    const posStr = POSITIONS[position] || POSITIONS.bottom;
    const dtFilter = `fontfile='${FONT}':textfile='${textFile}':fontsize=60:fontcolor=white:borderw=4:bordercolor=black:${posStr}`;
    const scale = 'scale=512:512:force_original_aspect_ratio=decrease';
    const pad   = 'pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000';
    const vf = isAnimated
        ? `${scale},fps=15,${pad},drawtext=${dtFilter}`
        : `${scale},format=rgba,${pad},drawtext=${dtFilter}`;

    const cmd = `"${ffmpegBin}" -y -i "${inputPath}" -vf "${vf}" -c:v libwebp -preset default -loop 0 -vsync 0 -pix_fmt yuva420p -quality 80 "${outputPath}"`;
    return new Promise((resolve, reject) =>
        exec(cmd, { maxBuffer: 50 * 1024 * 1024 }, (err) => err ? reject(err) : resolve())
    );
}

// ─── EXIF sticker metadata ────────────────────────────────────────────────────
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

// ─── Command ──────────────────────────────────────────────────────────────────
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
        const ALL_POSITIONS = ['center','top','bottom','left','right','topleft','topright','bottomleft','bottomright'];
        let position = 'bottom';
        let textArgs = [...args];
        const lastWord = args[args.length - 1].toLowerCase();
        const resolvedPos = POSITION_ALIASES[lastWord] || (ALL_POSITIONS.includes(lastWord) ? lastWord : null);
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

        const qMsg      = ctxInfo.quotedMessage;
        const isSticker = !!qMsg.stickerMessage;
        const isImage   = !!qMsg.imageMessage;
        const isVideo   = !!qMsg.videoMessage;
        const isAnimated = isSticker ? (qMsg.stickerMessage?.isAnimated ?? false) : isVideo;

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

            if (isAnimated) {
                // ── Animated sticker / video — needs ffmpeg with drawtext ────
                const ffBin = resolveFFmpeg();
                if (!ffBin) {
                    return extra.reply(
                        '❌ Animated stickers require ffmpeg with the *drawtext* filter, ' +
                        'which is not available on this server.\n\n' +
                        'Try with a *static* sticker or image instead.'
                    );
                }
                fs.writeFileSync(tempIn, buffer);
                fs.writeFileSync(textFile, text, 'utf8');
                await ffmpegDrawtext(ffBin, tempIn, tempOut, text, position, true, textFile);
                let webpBuf = fs.readFileSync(tempOut);
                webpBuf = await addExif(webpBuf);
                await sock.sendMessage(from, { sticker: webpBuf }, { quoted: msg });

            } else if (isSticker) {
                // ── Static sticker (WebP) — use sharp ───────────────────────
                let webpBuf = await overlayTextSharp(buffer, text, position, 'webp');
                webpBuf = await addExif(webpBuf);
                await sock.sendMessage(from, { sticker: webpBuf }, { quoted: msg });

            } else {
                // ── Static image — use sharp ─────────────────────────────────
                const jpgBuf = await overlayTextSharp(buffer, text, position, 'jpeg');
                await sock.sendMessage(from, { image: jpgBuf, caption: `✍️ ${text}` }, { quoted: msg });
            }

            await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });

        } catch (err) {
            console.error('[write] error:', err.message || err);
            await sock.sendMessage(from, { react: { text: '❌', key: msg.key } });
            await extra.reply(`❌ Failed to write text: ${err.message}`);
        } finally {
            tempFiles.forEach(f => { try { deleteTempFile(f); } catch(_) {} });
        }
    },
};
