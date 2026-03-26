/**
 * WebP to PNG / MP4 / GIF Converter
 * Uses FFmpeg directly — no intermediate frame extraction needed.
 * FFmpeg natively reads both static and animated WebP (including WhatsApp sticker format).
 */

const fs         = require('fs');
const path       = require('path');
const { exec }   = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { getTempDir, deleteTempFile } = require('./tempManager');

function run(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, { maxBuffer: 50 * 1024 * 1024 }, (err, _stdout, stderr) => {
            if (err) {
                // attach stderr so callers can log it
                err.ffmpegStderr = stderr || '';
                return reject(err);
            }
            resolve();
        });
    });
}

function tmpPath(ext, ts) {
    return path.join(getTempDir(), `webp_${ts}${ext}`);
}

/**
 * Convert WebP sticker to PNG image (static or first frame of animated).
 * @param {Buffer} webpBuffer
 * @returns {Promise<Buffer>} PNG buffer
 */
async function webp2png(webpBuffer) {
    const ts  = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const inp = tmpPath('_in.webp', ts);
    const out = tmpPath('_out.png', ts);
    try {
        fs.writeFileSync(inp, webpBuffer);
        // -frames:v 1  → grab only the first frame (works for both static + animated)
        await run(`"${ffmpegPath}" -y -i "${inp}" -frames:v 1 "${out}"`);
        if (!fs.existsSync(out)) throw new Error('FFmpeg produced no PNG output');
        return fs.readFileSync(out);
    } finally {
        try { fs.unlinkSync(inp); } catch {}
        try { fs.unlinkSync(out); } catch {}
    }
}

/**
 * Convert animated WebP sticker to MP4 video.
 * @param {Buffer} webpBuffer
 * @returns {Promise<Buffer>} MP4 buffer
 */
async function webp2mp4(webpBuffer) {
    const ts  = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const inp = tmpPath('_in.webp', ts);
    const out = tmpPath('_out.mp4', ts);
    try {
        fs.writeFileSync(inp, webpBuffer);
        // FFmpeg decodes animated WebP directly — no frame extraction needed
        await run(
            `"${ffmpegPath}" -y -i "${inp}" ` +
            `-vf "scale=512:512:flags=lanczos:force_original_aspect_ratio=decrease,` +
            `pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black" ` +
            `-c:v libx264 -pix_fmt yuv420p -movflags +faststart "${out}"`
        );
        if (!fs.existsSync(out)) throw new Error('FFmpeg produced no MP4 output');
        const buf = fs.readFileSync(out);
        if (!buf || buf.length === 0) throw new Error('MP4 buffer is empty');
        return buf;
    } catch (err) {
        console.error('[webp2mp4] FFmpeg error:', err.message);
        if (err.ffmpegStderr) console.error('[webp2mp4] stderr:', err.ffmpegStderr.slice(0, 600));
        throw err;
    } finally {
        try { fs.unlinkSync(inp); } catch {}
        try { fs.unlinkSync(out); } catch {}
    }
}

/**
 * Convert animated WebP sticker to GIF.
 * @param {Buffer} webpBuffer
 * @returns {Promise<Buffer>} GIF buffer
 */
async function webp2gif(webpBuffer) {
    const ts       = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const inp      = tmpPath('_in.webp', ts);
    const palette  = tmpPath('_pal.png', ts);
    const out      = tmpPath('_out.gif', ts);
    try {
        fs.writeFileSync(inp, webpBuffer);

        // Step 1: generate an optimal palette from the video stream
        await run(
            `"${ffmpegPath}" -y -i "${inp}" ` +
            `-vf "fps=15,scale=512:512:flags=lanczos:force_original_aspect_ratio=decrease,` +
            `pad=512:512:(ow-iw)/2:(oh-ih)/2,palettegen" "${palette}"`
        );

        // Step 2: encode GIF using the palette
        await run(
            `"${ffmpegPath}" -y -i "${inp}" -i "${palette}" ` +
            `-filter_complex "fps=15,scale=512:512:flags=lanczos:force_original_aspect_ratio=decrease,` +
            `pad=512:512:(ow-iw)/2:(oh-ih)/2[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5" ` +
            `-loop 0 "${out}"`
        );

        if (!fs.existsSync(out)) throw new Error('FFmpeg produced no GIF output');
        const buf = fs.readFileSync(out);
        if (!buf || buf.length === 0) throw new Error('GIF buffer is empty');
        return buf;
    } catch (err) {
        console.error('[webp2gif] FFmpeg error:', err.message);
        if (err.ffmpegStderr) console.error('[webp2gif] stderr:', err.ffmpegStderr.slice(0, 600));
        throw err;
    } finally {
        try { fs.unlinkSync(inp); } catch {}
        try { fs.unlinkSync(palette); } catch {}
        try { fs.unlinkSync(out); } catch {}
    }
}

module.exports = { webp2png, webp2gif, webp2mp4 };
