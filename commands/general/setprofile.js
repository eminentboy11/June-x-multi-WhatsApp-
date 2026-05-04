const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { Jimp } = require('jimp');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { tryFetchProfilePictureUrl, displayUserTag } = require(require('path').join(global.__CORE__, 'utils', 'jidHelper'));

function toJid(input) {
  if (!input) return null;
  let s = String(input).trim();
  if (s.includes('@')) return s;
  s = s.replace(/[^0-9]/g, '');
  if (!s) return null;
  return `${s}@s.whatsapp.net`;
}

module.exports = {
  name: 'setprofile',
  aliases: ['setdpfull', 'setppfull', 'setfullpp', 'setfulldp'],
  category: 'owner',
  description: 'Set bot full (uncropped) profile picture — from image reply, tagged user, phone number, or replied user',
  usage: '.setprofile (reply to image) | .setppfull @user | .setppfull <phone>',

  async execute(sock, msg, args, extra) {
    let imagePath = null;
    try {
      if (!extra.isOwner) {
        return extra.reply('❌ This command is only available for the owner!');
      }

      const ctx = msg.message?.extendedTextMessage?.contextInfo
                || msg.message?.imageMessage?.contextInfo
                || {};
      const groupMeta = extra.groupMetadata || null;

      let buffer = null;
      let sourceLabel = '';
      let targetUser = null;

      // 1) Mention / tag — checked FIRST so .setppfull @user uses the real JID
      //    (not the literal @1234 text in args, which can be a wrong number for @lid users)
      if (Array.isArray(ctx.mentionedJid) && ctx.mentionedJid.length) {
        targetUser = ctx.mentionedJid[0];
      }

      // 2) Phone number argument: .setppfull 254798570132
      //    Only if it's a plain number (no '@' literal text from a tag)
      if (!targetUser && args && args.length && args[0] && !args[0].startsWith('@')) {
        targetUser = toJid(args[0]);
      }

      // 3) Reply — could be to an image/sticker OR to a user (use their pp)
      const quotedMessage = ctx.quotedMessage;
      if (!buffer && quotedMessage) {
        let mediaMessage, mediaType;
        if (quotedMessage.imageMessage) {
          mediaMessage = quotedMessage.imageMessage;
          mediaType = 'image';
        } else if (quotedMessage.stickerMessage) {
          mediaMessage = quotedMessage.stickerMessage;
          mediaType = 'sticker';
        } else if (quotedMessage.viewOnceMessageV2?.message?.imageMessage) {
          mediaMessage = quotedMessage.viewOnceMessageV2.message.imageMessage;
          mediaType = 'image';
        }

        if (mediaMessage) {
          await extra.react('⏳');
          const stream = await downloadContentFromMessage(mediaMessage, mediaType);
          buffer = Buffer.from([]);
          for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
          }
          sourceLabel = 'replied media';
        } else if (!targetUser) {
          // Reply to a plain text message — use that user's profile picture
          targetUser = ctx.participant || ctx.remoteJid || null;
        }
      }

      // 4) If we have a target user but no buffer yet, fetch their profile picture
      if (!buffer && targetUser) {
        await extra.react('⏳');
        const tag = displayUserTag(targetUser, groupMeta);
        let result;
        try {
          result = await tryFetchProfilePictureUrl(sock, targetUser, groupMeta);
        } catch (e) {
          const code = e?.output?.statusCode;
          const m = (e?.message || '').toLowerCase();
          if (code === 401 || m.includes('forbidden') || m.includes('unauthorized')) {
            return extra.reply(`❌ @${tag}'s profile picture is private.`);
          }
          if (code === 404 || code === 500 || m.includes('not found') || m.includes('item-not-found')) {
            return extra.reply(`❌ No profile picture set for @${tag}.`);
          }
          return extra.reply('❌ Could not fetch that user\'s profile picture.');
        }
        if (!result || !result.url) {
          return extra.reply(`❌ No profile picture found for @${tag}.`);
        }
        const response = await axios.get(result.url, { responseType: 'arraybuffer', timeout: 30000 });
        buffer = Buffer.from(response.data);
        sourceLabel = `@${tag}'s profile picture`;
      }

      if (!buffer) {
        return extra.reply(
          '⚠️ Provide a source.\n\nUsage:\n• Reply to an image/sticker with .setppfull\n• .setppfull @user\n• .setppfull 254798570132\n• Reply to a user\'s message with .setppfull'
        );
      }

      const tmpDir = path.join(process.cwd(), 'tmp');
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

      // Pad image into a square so the FULL picture fits inside the WhatsApp
      // round profile frame (no center-crop). Empty space is white.
      const img = await Jimp.read(buffer);
      const w = img.bitmap.width;
      const h = img.bitmap.height;
      const size = Math.max(w, h);

      const canvas = new Jimp({ width: size, height: size, color: 0xffffffff });
      canvas.composite(img, Math.floor((size - w) / 2), Math.floor((size - h) / 2));
      const finalBuf = await canvas.getBuffer('image/jpeg');

      imagePath = path.join(tmpDir, `profile_full_${Date.now()}.jpg`);
      fs.writeFileSync(imagePath, finalBuf);

      const botJid = sock.user?.id || sock.user?.lid;
      await sock.updateProfilePicture(botJid, { url: imagePath });

      await extra.react('✅');
      const suffix = sourceLabel ? ` (from ${sourceLabel})` : '';
      const mentions = targetUser ? [targetUser] : [];
      await sock.sendMessage(extra.from, {
        text: `✅ Successfully updated bot *FULL* profile picture${suffix}!`,
        mentions,
      }, { quoted: msg });
    } catch (error) {
      console.error('Error in setprofile command:', error);
      try { await extra.react('❌'); } catch (_) {}
      try { await extra.reply(`❌ Failed to update full profile picture: ${error.message}`); } catch (_) {}
    } finally {
      if (imagePath && fs.existsSync(imagePath)) {
        try { fs.unlinkSync(imagePath); } catch (_) {}
      }
    }
  },
};
