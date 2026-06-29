/**
 * Logout Command - Owner only
 * Logs out the bot's WhatsApp session — bot cannot reconnect without a new session ID
 */

const fs = require('fs');
const path = require('path');
const config = require('../../config');

module.exports = {
  name: 'logout',
  aliases: ['clearsession', 'resetsession'],
  category: 'owner',
  description: 'Log out and invalidate the current WhatsApp session',
  usage: '.logout',
  ownerOnly: true,
  adminOnly: false,
  groupOnly: false,
  botAdminOnly: false,

  async execute(sock, msg, args, extra) {
    try {
      const sessionFolder = config.sessionName || 'session';
      const sessionPath = path.join(__dirname, '../../', sessionFolder);
      const credsPath = path.join(sessionPath, 'creds.json');

      if (!fs.existsSync(credsPath)) {
        return extra.reply('❌ No active session found.');
      }

      await extra.reply('⚠️ Logging out....');

      // Wipe all session files first
      const files = fs.readdirSync(sessionPath);
      for (const file of files) {
        fs.rmSync(path.join(sessionPath, file), { recursive: true, force: true });
      }

      // Officially log out from WhatsApp servers then terminate process
      await sock.logout();
      process.exit(0);

    } catch (error) {
      console.error('Logout command error:', error);
      // Force exit even if logout call fails
      process.exit(0);
    }
  }
};
