/**
 * ATTP - Animated Text to Picture Sticker
 * Blinking red/blue/green animated text sticker.
 * Uses node-webpmux (frame assembly) + system magick (text rendering).
 * No npm image library needed.
 */

const { spawnSync } = require('child_process');
const webp          = require('node-webpmux');
const MAGICK        = require('../../utils/magickPath');
const { writeExifVid } = require('../../utils/exif');

let _libReady = false;
async function initLib() {
    if (!_libReady) { await webp.Image.initLib(); _libReady = true; }
}

const COLORS  = ['#ff2222', '#1e90ff', '#00cc00'];
const GRAVITY = 'Center';

/** Render one frame as a WebP buffer using magick. */
function renderFrame(text, color, size, fontSize) {
    const r = spawnSync(MAGICK, [
        '-size', `${size}x${size}`, 'xc:black',
        '-fill', color,
        '-stroke', 'black', '-strokewidth', String(Math.max(4, Math.round(fontSize / 12))),
        '-font', 'DejaVu-Sans-Bold',
        '-pointsize', String(fontSize),
        '-gravity', GRAVITY,
        '-annotate', '0', text,
        'webp:-',
    ], { encoding: 'buffer', maxBuffer: 5 * 1024 * 1024 });

    if (r.error) throw r.error;
    if (!r.stdout || r.stdout.length < 10) {
        throw new Error('magick produced no output: ' + (r.stderr?.toString().trim() || 'unknown'));
    }
    return r.stdout;
}

/**
 * Build animated WebP with blinking coloured text.
 * cycles × 3 colours at delayMs each.
 */
async function renderAnimatedTextWebP(text, { size = 512, fontSize = 72, cycles = 6, delayMs = 150 } = {}) {
    await initLib();

    const totalFrames = cycles * COLORS.length;

    // Build base (static) WebP to load into outImg first
    const baseBuf = renderFrame(text, COLORS[0], size, fontSize);

    const outImg = new webp.Image();
    await outImg.load(baseBuf);
    await outImg.convertToAnim();

    for (let i = 0; i < totalFrames; i++) {
        const color    = COLORS[i % COLORS.length];
        const frameBuf = renderFrame(text, color, size, fontSize);
        outImg.frames.push(await webp.Image.generateFrame({ buffer: frameBuf, delay: delayMs }));
    }

    return outImg.save(null);
}

module.exports = {
    name: 'attp',
    aliases: ['ttp'],
    category: 'general',
    description: 'Create animated blinking text sticker',
    usage: '.attp <text>',

    async execute(sock, msg, args, extra) {
        try {
            if (args.length === 0) {
                return extra.reply(
                    `❌ Please provide text!\n\nExample: ${extra.prefix || '.'}attp Hello World`
                );
            }
            const text = args.join(' ');
            if (text.length > 50) return extra.reply('❌ Text too long! Maximum 50 characters.');

            await extra.reply('⏳ Generating animated sticker...');

            const webpBuf    = await renderAnimatedTextWebP(text);
            const stickerBuf = await writeExifVid(webpBuf, { packname: 'June Ultra' });
            await sock.sendMessage(extra.from, { sticker: stickerBuf }, { quoted: msg });

        } catch (err) {
            console.error('ATTP error:', err.message || err);
            await extra.reply('❌ Failed to generate animated sticker: ' + err.message);
        }
    },
};
