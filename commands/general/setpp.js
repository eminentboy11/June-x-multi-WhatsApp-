const fs = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

module.exports = {
  name: 'setpp',
  aliases: ['setprofilepic', 'setpfp'],
  category: 'owner',
  description: 'Set bot profile picture (reply to an image/sticker)',
  usage: '.setpp (reply to an image/sticker)',

  async execute(sock, msg, args, extra) {
    try {
      // Determine who is executing the command
      const senderId = msg.key.participant || msg.key.remoteJid;
      const isOwner = msg.key.fromMe || (await isSudo(senderId)); // isSudo must be defined elsewhere
      if (!isOwner) {
        return extra.reply('❌ This command is only available for the owner!');
      }

      // Ensure the command is a reply
      const quotedMessage = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      if (!quotedMessage) {
        return extra.reply('⚠️ Please reply to an image with the .setpp command!');
      }

      // Check if quoted message contains an image or sticker
      const mediaMessage = quotedMessage.imageMessage || quotedMessage.stickerMessage;
      if (!mediaMessage) {
        return extra.reply('❌ The replied message must contain an image or sticker!');
      }

      // Create temporary directory if it doesn't exist
      const tmpDir = path.join(process.cwd(), 'tmp');
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }

      // Download the media
      const stream = await downloadContentFromMessage(mediaMessage, 'image');
      let buffer = Buffer.from([]);
      for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
      }

      const imagePath = path.join(tmpDir, `profile_${Date.now()}.jpg`);
      fs.writeFileSync(imagePath, buffer);

      // Update bot profile picture
      await sock.updateProfilePicture(sock.user.id, { url: imagePath });

      // Clean up temporary file
      fs.unlinkSync(imagePath);

      await extra.reply('✅ Successfully updated bot profile picture!');
    } catch (error) {
      console.error('Error in setpp command:', error);
      extra.reply('❌ Failed to update profile picture!');
    }
  }
};
