/**
 * Restart Command - Restart bot (Owner Only)
 *
 * MULTI-SESSION: restarts ONLY the session that received the command.
 * Other sessions keep running without interruption. Uses the
 * global.__JUNE_RESTART_SESSION hook registered by index.js.
 *
 * LEGACY FALLBACK: when the hook is unavailable (single-session build or
 * standalone use), the original process.exit(1) behaviour is preserved.
 */

const { getCurrentBotId } = require('../../utils/core/botContext');

module.exports = {
  name: 'refresh',
  aliases: ['reloadbot'],
  category: 'owner',
  description: 'Refresh the bot (Owner Only)',
  usage: '.refresh',
  ownerOnly: true,

  async execute(sock, msg, args, extra) {
    try {
      const chatJid = msg.key.remoteJid;
      await extra.reply('🔁 Refreshing this session...');

      const hook = global.__JUNE_RESTART_SESSION;
      if (typeof hook === 'function') {
        // Multi-session: reboot only this bot. The bot id is captured inside
        // the timeout so ALS context routing still resolves this session.
        const botId = getCurrentBotId();
        setTimeout(() => {
          hook(botId).then((result) => {
            if (result?.ok && result.sock) {
              // Confirmation via the FRESH socket once it is connected.
              result.sock.sendMessage(chatJid, { text: '✅ Session restarted successfully.' })
                .catch(() => {});
            }
            // Failure details are logged by restartBot itself.
          }).catch(() => {});
        }, 500);
        return;
      }

      // Legacy single-session fallback: exit with code 1 so nodemon triggers
      // an automatic restart.
      setTimeout(() => {
        process.exit(1);
      }, 500);
    } catch (error) {
      console.error('Restart error:', error);
      await extra.reply(`❌ Error restarting bot: ${error.message}`);
    }
  },
};
