/**
 * WebP to PNG / MP4 / GIF Converter
 *
 * Strategy — avoids ffmpeg-static's broken animated-WebP decoder entirely:
 *   node-webpmux  → decodes WebP container, yields raw RGBA pixels per frame
 *   ffmpeg-static → receives raw RGBA frames via -f rawvideo → encodes MP4/GIF/PNG
 *
 * This works because ffmpeg-static's rawvideo reader is always available,
 * even though its WebP demuxer cannot decode animated WebP.
 */

const fs         = require('fs');
const path       = require('path');
const { exec }   = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { getTempDir, deleteTempFile } = require('./tempManager');

function run(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, { maxBuffer: 100 * 1024 * 1024 }, (err, _stdout, stderr) => {
            if (err) { err.ffmpegStderr = stderr || ''; return reject(err); }
            resolve();
        });
    });
}

function tmp(suffix, ts) {
    return path.join(getTempDir(), `webp_${ts}${suffix}`);
}

/**
 * Load a WebP buffer with node-webpmux.
 * Returns { img, isAnimated, frameCount }
 */
async function loadWebP(webpBuffer) {
    const { Image } = require('node-webpmux');
    await Image.initLib();          // required before getImageData / getFrameData
    const img = new Image();
    await img.load(webpBuffer);
    const frameCount = Array.isArray(img.frames) ? img.frames.length : 0;
    return { img, isAnimated: frameCount > 0, frameCount };
}

/**
 * Convert static WebP to PNG.
 * ffmpeg-static handles static WebP perfectly — only animated WebP is broken.
 * @param {Buffer} webpBuffer
 * @returns {Promise<Buffer>} PNG buffer
 */
async function webp2png(webpBuffer) {
    const ts     = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const inPath = tmp('_in.webp', ts);
    const outPath = tmp('_out.png', ts);
    try {
        fs.writeFileSync(inPath, webpBuffer);
        await run(`"${ffmpegPath}" -y -i "${inPath}" -frames:v 1 "${outPath}"`);
        if (!fs.existsSync(outPath)) throw new Error('PNG output not produced');
        return fs.readFileSync(outPath);
    } catch (err) {
        console.error('[webp2png] error:', err.message);
        if (err.ffmpegStderr) console.error('[webp2png] ffmpeg:', err.ffmpegStderr.slice(0, 400));
        throw err;
    } finally {
        try { fs.unlinkSync(inPath); } catch {}
        try { fs.unlinkSync(outPath); } catch {}
    }
}

/**
 * Collect all frames as a single concatenated RGBA buffer.
 * Falls back to a single frame if the WebP is not animated.
 */
async function collectRawFrames(img, frameCount) {
    if (frameCount === 0) {
        // static — single frame
        return { rgba: await img.getImageData(), count: 1 };
    }
    const bufs = [];
    for (let i = 0; i < frameCount; i++) {
        bufs.push(await img.getFrameData(i));
    }
    return { rgba: Buffer.concat(bufs), count: frameCount };
}

/**
 * Convert animated WebP sticker to MP4 video.
 * @param {Buffer} webpBuffer
 * @returns {Promise<Buffer>} MP4 buffer
 */
async function webp2mp4(webpBuffer) {
    const ts      = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const rawPath = tmp('_rgba.bin', ts);
    const outPath = tmp('_out.mp4', ts);
    try {
        const { img, frameCount } = await loadWebP(webpBuffer);
        const w = img.width;
        const h = img.height;

        const { rgba, count } = await collectRawFrames(img, frameCount);
        fs.writeFileSync(rawPath, rgba);

        // Determine frame rate from first frame delay (ms → fps), clamped 10-30
        let fps = 15;
        if (frameCount > 0 && img.frames[0].delay) {
            fps = Math.round(1000 / img.frames[0].delay);
            fps = Math.max(10, Math.min(30, fps));
        }

        await run(
            `"${ffmpegPath}" -y ` +
            `-f rawvideo -pix_fmt rgba -video_size ${w}x${h} -framerate ${fps} -i "${rawPath}" ` +
            `-vf "scale=512:512:flags=lanczos:force_original_aspect_ratio=decrease,` +
            `pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black" ` +
            `-c:v libx264 -pix_fmt yuv420p -movflags +faststart "${outPath}"`
        );

        if (!fs.existsSync(outPath)) throw new Error('MP4 output not produced');
        const buf = fs.readFileSync(outPath);
        if (!buf || buf.length === 0) throw new Error('MP4 buffer is empty');
        return buf;
    } catch (err) {
        console.error('[webp2mp4] error:', err.message);
        if (err.ffmpegStderr) console.error('[webp2mp4] ffmpeg:', err.ffmpegStderr.slice(0, 400));
        throw err;
    } finally {
        try { fs.unlinkSync(rawPath); } catch {}
        try { fs.unlinkSync(outPath); } catch {}
    }
}

/**
 * Convert animated WebP sticker to GIF.
 * @param {Buffer} webpBuffer
 * @returns {Promise<Buffer>} GIF buffer
 */
async function webp2gif(webpBuffer) {
    const ts       = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const rawPath  = tmp('_rgba.bin', ts);
    const palPath  = tmp('_pal.png', ts);
    const outPath  = tmp('_out.gif', ts);
    try {
        const { img, frameCount } = await loadWebP(webpBuffer);
        const w = img.width;
        const h = img.height;

        const { rgba } = await collectRawFrames(img, frameCount);
        fs.writeFileSync(rawPath, rgba);

        let fps = 15;
        if (frameCount > 0 && img.frames[0].delay) {
            fps = Math.round(1000 / img.frames[0].delay);
            fps = Math.max(10, Math.min(30, fps));
        }

        // Generate palette
        await run(
            `"${ffmpegPath}" -y ` +
            `-f rawvideo -pix_fmt rgba -video_size ${w}x${h} -framerate ${fps} -i "${rawPath}" ` +
            `-vf "scale=512:512:flags=lanczos:force_original_aspect_ratio=decrease,` +
            `pad=512:512:(ow-iw)/2:(oh-ih)/2,palettegen" "${palPath}"`
        );

        // Encode GIF
        await run(
            `"${ffmpegPath}" -y ` +
            `-f rawvideo -pix_fmt rgba -video_size ${w}x${h} -framerate ${fps} -i "${rawPath}" ` +
            `-i "${palPath}" ` +
            `-filter_complex "scale=512:512:flags=lanczos:force_original_aspect_ratio=decrease,` +
            `pad=512:512:(ow-iw)/2:(oh-ih)/2[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5" ` +
            `-loop 0 "${outPath}"`
        );

        if (!fs.existsSync(outPath)) throw new Error('GIF output not produced');
        const buf = fs.readFileSync(outPath);
        if (!buf || buf.length === 0) throw new Error('GIF buffer is empty');
        return buf;
    } catch (err) {
        console.error('[webp2gif] error:', err.message);
        if (err.ffmpegStderr) console.error('[webp2gif] ffmpeg:', err.ffmpegStderr.slice(0, 400));
        throw err;
    } finally {
        try { fs.unlinkSync(rawPath); } catch {}
        try { fs.unlinkSync(palPath); } catch {}
        try { fs.unlinkSync(outPath); } catch {}
    }
}

module.exports = { webp2png, webp2gif, webp2mp4 };
