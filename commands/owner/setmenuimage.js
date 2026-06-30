const config = require('../../config');
const fs = require('fs');
const path = require('path');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const https = require('https');
const http = require('http');
const db = require('../../database');

const IMAGE_PATH    = path.join(__dirname, '../../utils/bot_image.jpg');
const MENU1_PATH    = path.join(__dirname, '../../assets/menu1.jpg');
const PERSIST_PATH  = path.join(__dirname, '../../data/custom_menu.jpg'); // survives resets
const DEFAULT_IMAGE = path.join(__dirname, '../../assets/menu2.jpg'); // always present, used for reset

function downloadFromUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFromUrl(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function saveImage(buffer) {
  let finalBuffer = buffer;
  try {
    const Jimp = require('jimp');
    const image = await Jimp.read(buffer);
    finalBuffer = await image.quality(90).getBufferAsync(Jimp.MIME_JPEG);
  } catch {}
  // Write to disk for immediate use
  fs.writeFileSync(IMAGE_PATH, finalBuffer);
  try { fs.mkdirSync(path.dirname(PERSIST_PATH), { recursive: true }); } catch {}
  fs.writeFileSync(PERSIST_PATH, finalBuffer);   // persistent copy in data/
  try { fs.writeFileSync(MENU1_PATH, finalBuffer); } catch {}
  // Store image as base64 in database so it survives filesystem resets
  const dataSaved = db.setBotSetting('menuImageData', finalBuffer.toString('base64'));
  const flagSaved = db.setBotSetting('menuImageCustom', true);
  if (!dataSaved || !flagSaved) throw new Error('Image written to disk but could not be saved to database — image may not restore after restart.');
}

module.exports = {
  name: 'setmenuimage',
  aliases: ['setmenuimg', 'setbotimage', 'setbotimg', 'botimage', 'changemenuimage'],
  category: 'owner',
  description: 'Set bot/menu image. Reply to image, send URL, @mention, or use "reset".',
  usage: '.setmenuimage (reply to image) | .setmenuimage <url> | .setmenuimage @user | .setmenuimage reset',
  ownerOnly: true,

  async execute(sock, msg, args, extra) {
    try {
      const chatId = extra.from;
      const prefix = config.prefix || '';

      if (args[0] && args[0].toLowerCase() === 'reset') {
        try {
          // Remove the persistent custom copy first
          if (fs.existsSync(PERSIST_PATH)) fs.unlinkSync(PERSIST_PATH);
          const cleared = db.setBotSetting('menuImageCustom', false);
          db.setBotSetting('menuImageData', null);   // clear stored base64 to avoid stale data
          if (!cleared) return extra.reply('❌ Reset failed: could not update settings database.');
          // Restore default image from the permanent asset
          if (fs.existsSync(DEFAULT_IMAGE)) {
            const defaultBuf = fs.readFileSync(DEFAULT_IMAGE);
            fs.writeFileSync(MENU1_PATH, defaultBuf);
            fs.writeFileSync(IMAGE_PATH, defaultBuf);
            return extra.reply('✅ Bot image has been reset to default.');
          }
          // Fallback: just delete if default asset is somehow missing
          if (fs.existsSync(IMAGE_PATH)) fs.unlinkSync(IMAGE_PATH);
          if (fs.existsSync(MENU1_PATH)) fs.unlinkSync(MENU1_PATH);
          return extra.reply('✅ Bot image has been reset to default.');
        } catch (e) {
          return extra.reply(`❌ Reset failed: ${e.message}`);
        }
      }

      if (args[0] && /^https?:\/\//i.test(args[0])) {
        await extra.react('⏳');
        try {
          const buffer = await downloadFromUrl(args[0]);
          await saveImage(buffer);
          await extra.react('✅');
          return extra.reply('✅ Bot image updated from URL!');
        } catch (e) {
          return extra.reply(`❌ Failed to download image: ${e.message}`);
        }
      }

      const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
      if (mentioned && mentioned.length > 0) {
        await extra.react('⏳');
        try {
          const ppUrl = await sock.profilePictureUrl(mentioned[0], 'image');
          const buffer = await downloadFromUrl(ppUrl);
          await saveImage(buffer);
          await extra.react('✅');
          return extra.reply('✅ Bot image set from mentioned user\'s profile picture!');
        } catch {
          return extra.reply('❌ Could not get profile picture of mentioned user. They may not have one set.');
        }
      }

      const ctx = msg.message?.extendedTextMessage?.contextInfo;
      const quotedMsg = ctx?.quotedMessage;

      if (!quotedMsg) {
        return extra.reply(
          `📷 *Set Bot Image*\n\n` +
          `*Methods:*\n` +
          `• Reply to an image: *${prefix}setmenuimage*\n` +
          `• From URL: *${prefix}setmenuimage <url>*\n` +
          `• From user: *${prefix}setmenuimage @user*\n` +
          `• Remove: *${prefix}setmenuimage reset*`
        );
      }

      const imageMsg = quotedMsg.imageMessage || quotedMsg.stickerMessage;
      if (!imageMsg) {
        return extra.reply('❌ Reply to an *image* or *sticker*.');
      }

      await extra.react('⏳');

      const targetMessage = {
        key: { remoteJid: chatId, id: ctx.stanzaId, participant: ctx.participant },
        message: quotedMsg,
      };

      const mediaBuffer = await downloadMediaMessage(targetMessage, 'buffer', {}, {
        logger: undefined,
        reuploadRequest: sock.updateMediaMessage,
      });

      if (!mediaBuffer || mediaBuffer.length === 0) {
        return extra.reply('❌ Failed to download the image. Try sending a fresh image and replying to it.');
      }

      await saveImage(mediaBuffer);
      await extra.react('✅');
      await extra.reply('✅ Bot image updated!');
    } catch (error) {
      console.error('setmenuimage error:', error);
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};
