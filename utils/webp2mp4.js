/**
 * WebP to PNG/MP4 Converter
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { getTempDir, deleteTempFile } = require('./tempManager');

/**
 * Internal helper: convert a WebP buffer to PNG buffer using webp-converter (dwebp)
 */
async function _webpBufToPng(webpBuffer) {
  const webp = require('webp-converter');
  webp.grant_permission();
  const tempDir = getTempDir();
  const ts = Date.now() + '_' + Math.random().toString(36).slice(2);
  const inputPath = path.join(tempDir, `webpin_${ts}.webp`);
  const outputPath = path.join(tempDir, `pngout_${ts}.png`);
  try {
    fs.writeFileSync(inputPath, webpBuffer);
    await webp.dwebp(inputPath, outputPath, '-o');
    if (!fs.existsSync(outputPath)) throw new Error('dwebp produced no output');
    return fs.readFileSync(outputPath);
  } finally {
    try { fs.unlinkSync(inputPath); } catch {}
    try { fs.unlinkSync(outputPath); } catch {}
  }
}

/**
 * Convert WebP sticker to PNG image
 * @param {Buffer} webpBuffer - WebP sticker buffer
 * @returns {Promise<Buffer>} PNG image buffer
 */
async function webp2png(webpBuffer) {
  // Try webp-converter first (better for static WebP)
  try {
    return await _webpBufToPng(webpBuffer);
  } catch (convError) {
    // Fallback to FFmpeg
    console.log('webp-converter failed, trying FFmpeg:', convError.message);

    const tempDir = getTempDir();
    const timestamp = Date.now();
    const inputPath = path.join(tempDir, `webp_${timestamp}.webp`);
    const outputPath = path.join(tempDir, `png_${timestamp}.png`);

    try {
      fs.writeFileSync(inputPath, webpBuffer);

      const ffmpegCmd = `"${ffmpegPath}" -i "${inputPath}" -vf "select=eq(n\\,0)" -frames:v 1 -y "${outputPath}"`;

      await new Promise((resolve, reject) => {
        exec(ffmpegCmd, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
          if (error) {
            console.error('FFmpeg error:', error.message);
            if (stderr) console.error('FFmpeg stderr:', stderr.substring(0, 500));
            reject(error);
          } else {
            resolve();
          }
        });
      });

      if (!fs.existsSync(outputPath)) {
        throw new Error('PNG output file not found');
      }

      return fs.readFileSync(outputPath);
    } finally {
      try { deleteTempFile(inputPath); } catch {}
      try { deleteTempFile(outputPath); } catch {}
    }
  }
}

/**
 * Convert animated WebP sticker to GIF
 * @param {Buffer} webpBuffer - WebP sticker buffer
 * @returns {Promise<Buffer>} GIF buffer
 */
async function webp2gif(webpBuffer) {
  const tempDir = getTempDir();
  const timestamp = Date.now();
  const framesDir = path.join(tempDir, `frames_${timestamp}`);
  const outputPath = path.join(tempDir, `gif_${timestamp}.gif`);
  const palettePath = path.join(tempDir, `palette_${timestamp}.png`);

  console.log(`[webp2gif] Starting conversion, timestamp: ${timestamp}`);

  let gifBuffer = null;

  try {
    if (!fs.existsSync(framesDir)) {
      fs.mkdirSync(framesDir, { recursive: true });
    }

    // Use node-webpmux to extract all frames from animated WebP
    console.log(`[webp2gif] Extracting frames from animated WebP using node-webpmux...`);
    const webpmux = require('node-webpmux');
    const img = new webpmux.Image();
    await img.load(webpBuffer);

    const frameCount = img.frames ? img.frames.length : 0;
    console.log(`[webp2gif] Found ${frameCount} frames in WebP`);

    if (frameCount === 0) {
      // Single-frame WebP — convert using webp-converter
      console.log(`[webp2gif] No frames found, converting single frame using webp-converter...`);
      const pngBuffer = await _webpBufToPng(webpBuffer);
      fs.writeFileSync(path.join(framesDir, `frame_0000.png`), pngBuffer);
    } else {
      // Extract each frame buffer and convert to PNG
      for (let i = 0; i < frameCount; i++) {
        const frame = img.frames[i];
        const frameBuffer = frame.buffer;
        const framePath = path.join(framesDir, `frame_${i.toString().padStart(4, '0')}.png`);
        const pngBuffer = await _webpBufToPng(frameBuffer);
        fs.writeFileSync(framePath, pngBuffer);
        console.log(`[webp2gif] Extracted frame ${i + 1}/${frameCount}`);
      }
    }

    const frameFiles = fs.readdirSync(framesDir).filter(f => f.startsWith('frame_') && f.endsWith('.png')).sort();
    const actualFrameCount = frameFiles.length;
    console.log(`[webp2gif] Extracted ${actualFrameCount} frame files`);

    if (actualFrameCount === 0) {
      throw new Error('No frames extracted from WebP');
    }

    // Generate palette
    console.log(`[webp2gif] Generating palette from frames...`);
    const paletteCmd = `"${ffmpegPath}" -framerate 15 -i "${framesDir}/frame_%04d.png" -vf "fps=15,scale=512:512:flags=lanczos:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000,palettegen" -y "${palettePath}"`;

    await new Promise((resolve, reject) => {
      exec(paletteCmd, { maxBuffer: 10 * 1024 * 1024 }, (error) => {
        if (error) {
          console.error('[webp2gif] Palette generation error:', error.message);
          reject(error);
        } else {
          console.log(`[webp2gif] Palette generated`);
          resolve();
        }
      });
    });

    if (!fs.existsSync(palettePath)) {
      throw new Error('Palette file not found after generation');
    }

    // Convert frames to animated GIF
    console.log(`[webp2gif] Converting frames to animated GIF...`);
    const gifCmd = `"${ffmpegPath}" -framerate 15 -i "${framesDir}/frame_%04d.png" -i "${palettePath}" -lavfi "fps=15,scale=512:512:flags=lanczos:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5" -loop 0 -y "${outputPath}"`;

    await new Promise((resolve, reject) => {
      exec(gifCmd, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          console.error('[webp2gif] GIF conversion error:', error.message);
          if (stderr) console.error('[webp2gif] FFmpeg stderr:', stderr.substring(0, 500));
          reject(error);
        } else {
          console.log(`[webp2gif] FFmpeg conversion completed`);
          resolve();
        }
      });
    });

    if (!fs.existsSync(outputPath)) {
      throw new Error('GIF output file not found');
    }

    gifBuffer = fs.readFileSync(outputPath);

    if (!gifBuffer || gifBuffer.length === 0) {
      throw new Error('GIF buffer is empty');
    }

    // Cleanup AFTER reading
    try {
      if (fs.existsSync(framesDir)) {
        fs.readdirSync(framesDir).forEach(file => deleteTempFile(path.join(framesDir, file)));
        fs.rmdirSync(framesDir);
      }
      if (fs.existsSync(outputPath)) deleteTempFile(outputPath);
      if (fs.existsSync(palettePath)) deleteTempFile(palettePath);
    } catch (err) {
      console.error('[webp2gif] Error cleaning up temp files:', err);
    }

    return gifBuffer;
  } catch (error) {
    console.error(`[webp2gif] Error occurred: ${error.message}`);
    try {
      if (fs.existsSync(framesDir)) {
        fs.readdirSync(framesDir).forEach(file => deleteTempFile(path.join(framesDir, file)));
        fs.rmdirSync(framesDir);
      }
      if (fs.existsSync(outputPath)) deleteTempFile(outputPath);
      if (fs.existsSync(palettePath)) deleteTempFile(palettePath);
    } catch {}
    throw error;
  }
}

/**
 * Convert WebP sticker to MP4 video (for animated stickers)
 * @param {Buffer} webpBuffer - WebP sticker buffer
 * @returns {Promise<Buffer>} MP4 video buffer
 */
async function webp2mp4(webpBuffer) {
  const tempDir = getTempDir();
  const timestamp = Date.now();
  const framesDir = path.join(tempDir, `frames_${timestamp}`);
  const outputPath = path.join(tempDir, `mp4_${timestamp}.mp4`);

  let mp4Buffer = null;

  try {
    if (!fs.existsSync(framesDir)) {
      fs.mkdirSync(framesDir, { recursive: true });
    }

    // Use node-webpmux to extract frames (same approach as webp2gif)
    const webpmux = require('node-webpmux');
    const img = new webpmux.Image();
    await img.load(webpBuffer);

    const frameCount = img.frames ? img.frames.length : 0;

    if (frameCount === 0) {
      // Single-frame — convert with webp-converter
      const pngBuffer = await _webpBufToPng(webpBuffer);
      fs.writeFileSync(path.join(framesDir, `frame_0000.png`), pngBuffer);
    } else {
      for (let i = 0; i < frameCount; i++) {
        try {
          const frame = img.frames[i];
          const framePath = path.join(framesDir, `frame_${i.toString().padStart(4, '0')}.png`);
          const pngBuffer = await _webpBufToPng(frame.buffer);
          fs.writeFileSync(framePath, pngBuffer);
        } catch (frameError) {
          // Continue with other frames
        }
      }
    }

    const frameFiles = fs.readdirSync(framesDir).filter(f => f.startsWith('frame_') && f.endsWith('.png')).sort();
    if (frameFiles.length === 0) {
      throw new Error('No frames extracted from WebP');
    }

    const mp4Cmd = `"${ffmpegPath}" -framerate 15 -i "${framesDir}/frame_%04d.png" -vf "fps=15,scale=512:512:flags=lanczos:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000" -c:v libx264 -pix_fmt yuv420p -movflags +faststart -fps_mode vfr -y "${outputPath}"`;

    await new Promise((resolve, reject) => {
      exec(mp4Cmd, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) reject(error);
        else resolve();
      });
    });

    if (!fs.existsSync(outputPath)) {
      throw new Error('MP4 output file not found');
    }

    mp4Buffer = fs.readFileSync(outputPath);

    if (!mp4Buffer || mp4Buffer.length === 0) {
      throw new Error('MP4 buffer is empty');
    }

    // Cleanup AFTER reading
    try {
      if (fs.existsSync(framesDir)) {
        fs.readdirSync(framesDir).forEach(file => deleteTempFile(path.join(framesDir, file)));
        fs.rmdirSync(framesDir);
      }
      if (fs.existsSync(outputPath)) deleteTempFile(outputPath);
    } catch {}

    return mp4Buffer;
  } catch (error) {
    try {
      if (fs.existsSync(framesDir)) {
        fs.readdirSync(framesDir).forEach(file => deleteTempFile(path.join(framesDir, file)));
        fs.rmdirSync(framesDir);
      }
      if (fs.existsSync(outputPath)) deleteTempFile(outputPath);
    } catch {}
    throw error;
  }
}

module.exports = {
  webp2png,
  webp2gif,
  webp2mp4
};
