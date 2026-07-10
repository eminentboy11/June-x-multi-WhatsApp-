/**
 * Sticker Creation Utilities
 */

const { Sticker, createSticker, StickerTypes } = require('wa-sticker-formatter');
const config = require('../../config');

/**
 * Create sticker from image/video buffer
 */
const createStickerBuffer = async (media, options = {}) => {
  try {
    const sticker = new Sticker(media, {
      pack: options.pack || config.packname,
      author: options.author || config.author,
      type: options.type || StickerTypes.FULL,
      categories: options.categories || ['🤖'],
      id: options.id || '',
      quality: options.quality || 50
    });
    
    return await sticker.toBuffer();
  } catch (error) {
    throw new Error(`Sticker creation failed: ${error.message}`);
  }
};

/**
 * Create cropped sticker
 */
const createCroppedSticker = async (media, options = {}) => {
  try {
    const sticker = new Sticker(media, {
      pack: options.pack || config.packname,
      author: options.author || config.author,
      type: StickerTypes.CROPPED,
      categories: options.categories || ['🤖'],
      quality: options.quality || 50
    });
    
    return await sticker.toBuffer();
  } catch (error) {
    throw new Error(`Cropped sticker creation failed: ${error.message}`);
  }
};

/**
 * Create circle sticker
 */
const createCircleSticker = async (media, options = {}) => {
  try {
    const sticker = new Sticker(media, {
      pack: options.pack || config.packname,
      author: options.author || config.author,
      type: StickerTypes.CIRCLE,
      categories: options.categories || ['🤖'],
      quality: options.quality || 50
    });
    
    return await sticker.toBuffer();
  } catch (error) {
    throw new Error(`Circle sticker creation failed: ${error.message}`);
  }
};

/**
 * Convert sticker (WebP) to PNG image using webp-converter
 */
const stickerToImage = async (stickerBuffer) => {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const webp = require('webp-converter');
  webp.grant_permission();

  const ts = Date.now() + '_' + Math.random().toString(36).slice(2);
  const tmpDir = os.tmpdir();
  const inputPath = path.join(tmpDir, `sticker_${ts}.webp`);
  const outputPath = path.join(tmpDir, `sticker_${ts}.png`);

  try {
    fs.writeFileSync(inputPath, stickerBuffer);
    await webp.dwebp(inputPath, outputPath, '-o');
    if (!fs.existsSync(outputPath)) throw new Error('dwebp produced no output');
    return fs.readFileSync(outputPath);
  } catch (error) {
    throw new Error(`Sticker to image conversion failed: ${error.message}`);
  } finally {
    try { fs.unlinkSync(inputPath); } catch {}
    try { fs.unlinkSync(outputPath); } catch {}
  }
};

module.exports = {
  createStickerBuffer,
  createCroppedSticker,
  createCircleSticker,
  stickerToImage
};
