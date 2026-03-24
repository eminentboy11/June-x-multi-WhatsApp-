/**
 * GetSession Command - Owner only
 * Generates a KnightBot:~<base64> session ID from the current creds.json
 * so the bot can be redeployed without scanning a QR code again.
 */

const fs = require('fs');
const path = require('path');
const config = require('../../config');

module.exports = {
  name: 'getsession',
  aliases: ['sessionid', 'mysession', 'session'],
  category: 'owner',
  description: 'Get the current session ID in base64 format for redeployment',
  usage: '.getsession',
  ownerOnly: true,
  adminOnly: false,
  groupOnly: false,
  botAdminOnly: false,

  async execute(sock, msg, args, extra) {
    try {
      const sessionFolder = config.sessionName || 'session';
      const credsPath = path.join(__dirname, '../../', sessionFolder, 'creds.json');

      if (!fs.existsSync(credsPath)) {
        return extra.reply(
          '❌ *No session file found!*\n\n' +
          'The bot does not have a saved session yet.\n' +
          'Connect the bot via QR code first, then run this command.'
        );
      }

      await extra.reply('⏳ Generating your session ID, please wait...');

      const credsJson = fs.readFileSync(credsPath, 'utf8');

      // Validate JSON before encoding
      JSON.parse(credsJson);

      const base64Session = Buffer.from(credsJson, 'utf8').toString('base64');
      const sessionID = `KnightBot:~${base64Session}`;

      const instructions =
        `╭━━『 *Session ID Generated* 』━━╮\n\n` +
        `✅ Your session ID is ready!\n\n` +
        `📋 *How to use:*\n` +
        `1️⃣ Copy the session ID sent below\n` +
        `2️⃣ Open your bot's environment secrets\n` +
        `3️⃣ Set *SESSION_ID* to the copied value\n` +
        `4️⃣ Restart the bot — no QR scan needed!\n\n` +
        `⚠️ *Keep this secret!* Anyone with this ID\n` +
        `   can access your WhatsApp account.\n\n` +
        `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━╯`;

      await extra.reply(instructions);

      // Send the session ID as a separate message (easier to copy)
      await sock.sendMessage(extra.from, {
        text: sessionID
      }, { quoted: msg });

    } catch (error) {
      console.error('GetSession command error:', error);
      await extra.reply(`❌ Failed to generate session ID: ${error.message}`);
    }
  }
};
