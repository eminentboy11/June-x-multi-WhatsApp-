/**
 * Refresh Command — reconnect only the session that receives the command.
 * Other sessions remain online. Uses the per-session restart hook from index.js.
 */

const { getCurrentBotId } = require('../../utils/core/botContext');

async function sendWhenFreshSocketIsReady(sock, chatJid, text, timeoutMs = 60000) {
  if (!sock?.sendMessage) return false;

  return new Promise((resolve) => {
    let settled = false;
    let timeout;

    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try { sock.ev?.off?.('connection.update', onConnectionUpdate); } catch (_) {}
      resolve(ok);
    };

    const sendConfirmation = async () => {
      if (settled) return;
      try {
        await sock.sendMessage(chatJid, { text });
        finish(true);
      } catch (_) {
        // The connection-open event will retry. Keep waiting until timeout.
      }
    };

    const onConnectionUpdate = (update) => {
      if (update?.connection === 'open') void sendConfirmation();
      if (update?.connection === 'close') return;
    };

    sock.ev?.on?.('connection.update', onConnectionUpdate);
    timeout = setTimeout(() => finish(false), timeoutMs);
    timeout.unref?.();

    // Covers the normal case where restartBot already waited for connection,
    // and the race where it opened immediately before this listener was added.
    void sendConfirmation();
  });
}

module.exports = {
  name: 'refresh',
  aliases: ['reloadbot'],
  category: 'botmanager',
  description: 'Refresh only the current bot session',
  usage: '.refresh',
  ownerOnly: true,

  async execute(sock, msg, args, extra) {
    const chatJid = msg.key.remoteJid;

    try {
      await extra.reply('🔁 Refreshing this session...');

      const hook = global.__JUNE_RESTART_SESSION;
      if (typeof hook !== 'function') {
        // Legacy fallback: the process supervisor must bring the bot back.
        setTimeout(() => process.exit(1), 500);
        return;
      }

      const botId = getCurrentBotId();
      const result = await hook(botId);

      if (!result?.ok || !result.sock) {
        const reason = result?.error || 'the replacement socket could not start';
        try { await extra.reply(`❌ Session refresh failed: ${reason}`); } catch (_) {}
        return;
      }

      const delivered = await sendWhenFreshSocketIsReady(
        result.sock,
        chatJid,
        '✅ Session refreshed successfully.\n🟢 Connection restored and commands are ready.'
      );

      if (!delivered) {
        // Keep this visible in panel logs if WhatsApp never reopened; the old
        // socket is already gone, so no reliable chat channel exists here.
        console.warn(`[refresh:${botId}] Session restarted but confirmation could not be delivered within 60 seconds.`);
      }
    } catch (error) {
      console.error('Refresh error:', error);
      try { await extra.reply(`❌ Error refreshing session: ${error.message}`); } catch (_) {}
    }
  },

  // Exported only for focused regression tests.
  _sendWhenFreshSocketIsReady: sendWhenFreshSocketIsReady,
};
