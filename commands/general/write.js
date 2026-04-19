/**
 * Write Command — overlay meme text on stickers/images (static & animated).
 * Usage: .write <text> [position] — reply to image or sticker
 *
 * Positions: center (default), top, bottom, left, right,
 *            topleft, topright, bottomleft, bottomright
 *
 * Uses node-webpmux (WebP reading/writing) + system magick (text rendering).
 * No npm image library needed.
 */

const { spawnSync }    = require('child_process');
const webp             = require('node-webpmux');
const MAGICK           = require('../../utils/magickPath');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { getTempDir, deleteTempFile } = require('../../utils/tempManager');
const config           = require('../../config');
const crypto           = require('crypto');
const path             = require('path');

// ─── Lib init ─────────────────────────────────────────────────────────────────
let _libReady = false;
async function initLib() {
    if (!_libReady) { await webp.Image.initLib(); _libReady = true; }
}

// ─── Position / gravity mapping ──────────────────────────────────────────────
const POSITION_ALIASES = {
    mid: 'center', middle: 'center',
    up: 'top', down: 'bottom',
    r: 'right', l: 'left',
};
const ALL_POSITIONS = [
    'center','top','bottom','left','right',
    'topleft','topright','bottomleft','bottomright',
];
const GRAVITY_MAP = {
    center:      'Center',
    top:         'North',
    bottom:      'South',
    left:        'West',
    right:       'East',
    topleft:     'NorthWest',
    topright:    'NorthEast',
    bottomleft:  'SouthWest',
    bottomright: 'SouthEast',
};

// ─── magick helpers ───────────────────────────────────────────────────────────
const FONT     = 'DejaVu-Sans-Bold';
const FONTSIZE = '48';
const STROKE_W = '5';

/**
 * Run magick with stdin/stdout piping.
 * args: array of magick arguments. stdin: Buffer.
 * Returns stdout Buffer (the output image/WebP).
 */
function magickPipe(args, stdin) {
    const r = spawnSync(MAGICK, args, {
        input:     stdin,
        encoding:  'buffer',
        maxBuffer: 15 * 1024 * 1024,
    });
    if (r.error)  throw r.error;
    if (!r.stdout || r.stdout.length < 10) {
        throw new Error('magick failed: ' + (r.stderr?.toString().trim().slice(0, 200) || 'no output'));
    }
    return r.stdout;
}

/**
 * Add text to a static image (any format magick can read).
 * Returns WebP buffer.
 */
function annotateStatic(inputBuf, text, gravity) {
    return magickPipe([
        '-',
        '-fill',  'white',
        '-stroke', 'black', '-strokewidth', STROKE_W,
        '-font', FONT, '-pointsize', FONTSIZE,
        '-gravity', gravity,
        '-annotate', '0', text,
        'webp:-',
    ], inputBuf);
}

/**
 * Add text to every frame of an animated WebP.
 * Returns an animated WebP buffer.
 */
function annotateAnimated(inputBuf, text, gravity) {
    return magickPipe([
        '-',
        '-coalesce',
        '-fill',  'white',
        '-stroke', 'black', '-strokewidth', STROKE_W,
        '-font', FONT, '-pointsize', FONTSIZE,
        '-gravity', gravity,
        '-annotate', '0', text,
        'webp:-',
    ], inputBuf);
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
        let position = 'bottom';
        let textArgs = [...args];
        const lastWord  = args[args.length - 1].toLowerCase();
        const resolved  = POSITION_ALIASES[lastWord] || (ALL_POSITIONS.includes(lastWord) ? lastWord : null);
        if (resolved) {
            position = resolved;
            textArgs = args.slice(0, -1);
        }

        const text = textArgs.join(' ').trim();
        if (!text) return extra.reply('❌ Please provide the text to write.');

        const ctxInfo = msg.message?.extendedTextMessage?.contextInfo;
        if (!ctxInfo?.quotedMessage) {
            return extra.reply('❌ Reply to a sticker or image with this command.');
        }

        const qMsg       = ctxInfo.quotedMessage;
        const isSticker  = !!qMsg.stickerMessage;
        const isImage    = !!qMsg.imageMessage;
        const isVideo    = !!qMsg.videoMessage;
        const isAnimated = isSticker ? (qMsg.stickerMessage?.isAnimated ?? false) : isVideo;

        if (!isSticker && !isImage && !isVideo) {
            return extra.reply('❌ Reply to a sticker or image.');
        }

        await sock.sendMessage(from, { react: { text: '⏳', key: msg.key } });

        try {
            const quotedMsgObj = {
                key: {
                    remoteJid: from,
                    id:          ctxInfo.stanzaId,
                    participant: ctxInfo.participant,
                },
                message: qMsg,
            };

            const buffer = await downloadMediaMessage(
                quotedMsgObj, 'buffer', {},
                { logger: undefined, reuploadRequest: sock.updateMediaMessage }
            );
            if (!buffer) return extra.reply('❌ Failed to download media.');

            await initLib();

            const gravity = GRAVITY_MAP[position] || 'South';

            if (isAnimated) {
                let webpBuf = annotateAnimated(buffer, text, gravity);
                webpBuf = await addExif(webpBuf);
                await sock.sendMessage(from, { sticker: webpBuf }, { quoted: msg });

            } else if (isSticker) {
                let webpBuf = annotateStatic(buffer, text, gravity);
                webpBuf = await addExif(webpBuf);
                await sock.sendMessage(from, { sticker: webpBuf }, { quoted: msg });

            } else {
                // Regular image — return as image (JPEG)
                const jpgBuf = magickPipe([
                    '-',
                    '-fill',  'white',
                    '-stroke', 'black', '-strokewidth', STROKE_W,
                    '-font', FONT, '-pointsize', FONTSIZE,
                    '-gravity', gravity,
                    '-annotate', '0', text,
                    'jpeg:-',
                ], buffer);
                await sock.sendMessage(from, { image: jpgBuf, caption: `✍️ ${text}` }, { quoted: msg });
            }

            await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });

        } catch (err) {
            console.error('[write] error:', err.message || err);
            await sock.sendMessage(from, { react: { text: '❌', key: msg.key } });
            await extra.reply(`❌ Failed to write text: ${err.message}`);
        }
    },
};
