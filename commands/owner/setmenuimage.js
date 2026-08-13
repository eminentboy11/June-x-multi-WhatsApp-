'use strict';

/**
 * Custom menu image command.
 *
 * The custom image is stored only in SQLite bot_settings as base64 data.
 * Bundled images remain application defaults and are never overwritten.
 */

const config = require('../../config');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const https = require('https');
const http = require('http');
const db = require('../../database');

function applyMenuStyle3() {
  try {
    db.updateMenuSettings({ menuStyle: '3' });
  } catch (error) {
    console.error('[setmenuimage] Could not auto-set menu style:', error.message);
  }
}

function downloadFromUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFromUrl(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function saveImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Image data is empty.');
  }

  let finalBuffer = buffer;
  try {
    const Jimp = require('jimp');
    const image = await Jimp.read(buffer);
    finalBuffer = await image.quality(90).getBufferAsync(Jimp.MIME_JPEG);
  } catch (_) {
    // Keep the source buffer when optional image normalisation is unavailable.
  }

  const saved = db.setMenuImageData(finalBuffer.toString('base64'));
  if (!saved) {
    throw new Error('Could not save the custom menu image to SQLite.');
  }
}

module.exports = {
  name: 'setmenuimage',
  aliases: ['setmenuimg', 'setbotimage', 'setbotimg', 'botimage', 'menuimage'],
  category: 'owner',
  description: 'Set the SQLite-backed menu image from an image, URL, or user profile',
  usage: '.setmenuimage (reply to image) | .setmenuimage <url> | .setmenuimage @user | .setmenuimage reset',
  ownerOnly: true,

  async execute(sock, msg, args, extra) {
    try {
      const chatId = extra.from;
      const prefix = config.prefix || '.';

      if (args[0] && args[0].toLowerCase() === 'reset') {
        db.clearMenuImageData();
        return extra.reply('✅ Custom menu image removed. June X will use a bundled default image.');
      }

      if (args[0] && /^https?:\/\//i.test(args[0])) {
        await extra.react('⏳');
        try {
          const buffer = await downloadFromUrl(args[0]);
          await saveImage(buffer);
          applyMenuStyle3();
          await extra.react('✅');
          return extra.reply('✅ Menu image saved to SQLite from URL! Menu style auto-set to Style 3.');
        } catch (error) {
          return extra.reply(`❌ Failed to download image: ${error.message}`);
        }
      }

      const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
      if (mentioned?.length) {
        await extra.react('⏳');
        try {
          const profilePictureUrl = await sock.profilePictureUrl(mentioned[0], 'image');
          const buffer = await downloadFromUrl(profilePictureUrl);
          await saveImage(buffer);
          applyMenuStyle3();
          await extra.react('✅');
          return extra.reply('✅ Menu image saved to SQLite from the mentioned user\'s profile picture!');
        } catch (_) {
          return extra.reply('❌ Could not get the mentioned user\'s profile picture. They may not have one set.');
        }
      }

      const context = msg.message?.extendedTextMessage?.contextInfo;
      const quotedMessage = context?.quotedMessage;

      if (!quotedMessage) {
        return extra.reply(
          `📷 *Set Menu Image*\n\n` +
          `*Methods:*\n` +
          `• Reply to an image: *${prefix}setmenuimage*\n` +
          `• From URL: *${prefix}setmenuimage <url>*\n` +
          `• From user: *${prefix}setmenuimage @user*\n` +
          `• Remove: *${prefix}setmenuimage reset*`
        );
      }

      const imageMessage = quotedMessage.imageMessage || quotedMessage.stickerMessage;
      if (!imageMessage) {
        return extra.reply('❌ Reply to an *image* or *sticker*.');
      }

      await extra.react('⏳');
      const targetMessage = {
        key: { remoteJid: chatId, id: context.stanzaId, participant: context.participant },
        message: quotedMessage,
      };

      const mediaBuffer = await downloadMediaMessage(targetMessage, 'buffer', {}, {
        logger: undefined,
        reuploadRequest: sock.updateMediaMessage,
      });

      if (!mediaBuffer || mediaBuffer.length === 0) {
        return extra.reply('❌ Failed to download the image. Try sending a fresh image and replying to it.');
      }

      await saveImage(mediaBuffer);
      applyMenuStyle3();
      await extra.react('✅');
      await extra.reply('✅ Menu image saved to SQLite! Menu style auto-set to Style 3.');
    } catch (error) {
      console.error('setmenuimage error:', error);
      await extra.reply(`❌ Error: ${error.message}`);
    }
  },
};
