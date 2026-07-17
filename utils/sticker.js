/**
 * Sticker Creation Utilities
 * No sharp — uses ffmpeg (via fluent-ffmpeg) for image/video -> webp conversion
 * and node-webpmux for injecting WhatsApp sticker EXIF metadata.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('./ffmpegPath');
const webpmux = require('node-webpmux');
const { fileTypeFromBuffer } = require('file-type');
const config = require('../config');

ffmpeg.setFfmpegPath(ffmpegPath);

const tmpFile = (ext) =>
  path.join(os.tmpdir(), `stk_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`);

const cleanup = (...files) => {
  for (const f of files) {
    try { fs.unlinkSync(f); } catch {}
  }
};

const VIDEO_MIMES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/3gpp', 'image/gif'];

/**
 * Detect input extension from buffer content (not filename).
 */
const detectExt = async (buffer) => {
  const type = await fileTypeFromBuffer(buffer);
  return { ext: type?.ext || 'bin', mime: type?.mime || '', isAnimated: type ? VIDEO_MIMES.includes(type.mime) : false };
};

/**
 * Build the EXIF chunk WhatsApp expects on sticker webp files.
 */
const buildExif = ({ pack, author, categories = [] }) => {
  const json = {
    'sticker-pack-id': `com.junex.${Date.now()}`,
    'sticker-pack-name': pack,
    'sticker-pack-publisher': author,
    'emojis': categories
  };
  const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf8');
  const exifHeader = Buffer.from([
    0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57,
    0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00
  ]);
  exifHeader.writeUIntLE(jsonBuffer.length, 14, 4);
  return Buffer.concat([exifHeader, jsonBuffer]);
};

/**
 * Inject sticker metadata (pack/author/categories) into a webp buffer.
 */
const applyExif = async (webpBuffer, options) => {
  const img = new webpmux.Image();
  await img.load(webpBuffer);
  img.exif = buildExif(options);
  return img.save(null);
};

/**
 * Convert an image/video/gif buffer into a 512x512 webp buffer via ffmpeg.
 * mode: 'full' (fit, padded) | 'cropped' (fill, square crop) | 'circle' (fill + circular mask)
 */
const toWebp = (mediaBuffer, inputExt, isAnimated, mode = 'full') =>
  new Promise((resolve, reject) => {
    const inputPath = tmpFile(inputExt);
    const outputPath = tmpFile('webp');
    fs.writeFileSync(inputPath, mediaBuffer);

    let filterComplex;
    let outputMaps = null;

    if (mode === 'circle') {
      // Fill-crop to 512x512, then mask with a circle drawn via ffmpeg geq (alpha channel).
      filterComplex = [
        `[0:v]scale=512:512:force_original_aspect_ratio=increase,crop=512:512,fps=15,format=rgba[base]`,
        `[base]geq=` +
          `r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':` +
          `a='if(lte(pow(X-256,2)+pow(Y-256,2),pow(256,2)),alpha(X,Y),0)'` +
          `[circ]`
      ].join(';');
      outputMaps = '[circ]';
    } else if (mode === 'cropped') {
      filterComplex = `[0:v]scale=512:512:force_original_aspect_ratio=increase,crop=512:512,fps=15,format=rgba[out]`;
      outputMaps = '[out]';
    } else {
      filterComplex =
        `[0:v]scale=512:512:force_original_aspect_ratio=decrease,` +
        `pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,fps=15,format=rgba[out]`;
      outputMaps = '[out]';
    }

    const command = ffmpeg(inputPath)
      .complexFilter(filterComplex, outputMaps)
      .outputOptions([
        '-vcodec', 'libwebp',
        '-loop', '0',
        '-preset', 'picture',
        '-an',
        '-vsync', '0',
        isAnimated ? '-t' : '-frames:v', isAnimated ? '6' : '1'
      ])
      .toFormat('webp')
      .save(outputPath)
      .on('end', () => {
        try {
          const buf = fs.readFileSync(outputPath);
          resolve(buf);
        } catch (err) {
          reject(err);
        } finally {
          cleanup(inputPath, outputPath);
        }
      })
      .on('error', (err) => {
        cleanup(inputPath, outputPath);
        reject(err);
      });
  });

/**
 * Shared pipeline: media buffer -> webp -> exif-tagged sticker buffer.
 */
const buildSticker = async (media, mode, options = {}) => {
  const { ext, isAnimated } = await detectExt(media);
  const webpBuffer = await toWebp(media, ext, isAnimated, mode);
  return applyExif(webpBuffer, {
    pack: options.pack || config.packname,
    author: options.author || config.author,
    categories: options.categories || ['🤖']
  });
};

/**
 * Create sticker from image/video buffer (fit, padded — "full" type)
 */
const createStickerBuffer = async (media, options = {}) => {
  try {
    return await buildSticker(media, 'full', options);
  } catch (error) {
    throw new Error(`Sticker creation failed: ${error.message}`);
  }
};

/**
 * Create cropped sticker (fill, square crop)
 */
const createCroppedSticker = async (media, options = {}) => {
  try {
    return await buildSticker(media, 'cropped', options);
  } catch (error) {
    throw new Error(`Cropped sticker creation failed: ${error.message}`);
  }
};

/**
 * Create circle sticker (fill, square crop, circular alpha mask)
 */
const createCircleSticker = async (media, options = {}) => {
  try {
    return await buildSticker(media, 'circle', options);
  } catch (error) {
    throw new Error(`Circle sticker creation failed: ${error.message}`);
  }
};

/**
 * Convert sticker (WebP) to PNG image using webp-converter
 */
const stickerToImage = async (stickerBuffer) => {
  const webp = require('webp-converter');
  webp.grant_permission();

  const inputPath = tmpFile('webp');
  const outputPath = tmpFile('png');

  try {
    fs.writeFileSync(inputPath, stickerBuffer);
    await webp.dwebp(inputPath, outputPath, '-o');
    if (!fs.existsSync(outputPath)) throw new Error('dwebp produced no output');
    return fs.readFileSync(outputPath);
  } catch (error) {
    throw new Error(`Sticker to image conversion failed: ${error.message}`);
  } finally {
    cleanup(inputPath, outputPath);
  }
};

module.exports = {
  createStickerBuffer,
  createCroppedSticker,
  createCircleSticker,
  stickerToImage
};
