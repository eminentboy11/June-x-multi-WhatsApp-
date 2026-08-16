/**
 * DelBot Command - Hot-remove a session while the bot is running
 * (PLATFORM-LEVEL — Super Owner only)
 *
 * Usage: .delbot <phone|id>
 *
 * Permanently removes the registry entry, unlinks/stops the session, clears
 * authentication and deletes its bot-specific local/remote data. Use
 * .pausebot instead when authentication should be preserved.
 */

module.exports = {
  name: 'delbot',
  aliases: ['removesession', 'rmbot', 'deletebot'],
  category: 'botmanager',
  description: 'Permanently delete a bot session and its stored authentication',
  usage: '.delbot <phone|id>',
  superOwnerOnly: true,
  superOwnerSessionOnly: true,

  async execute(sock, msg, args, extra) {
    const identifier = String(args[0] || '').trim();
    if (!identifier) {
      return extra.reply(
        '⚠️ *Usage:* .delbot <phone|id>\n\n' +
        'Example: .delbot 2348165321909\n' +
        '_(also works with a session id — check .bots for ids)_'
      );
    }

    const hook = global.__JUNE_REMOVE_SESSION;
    if (typeof hook !== 'function') {
      return extra.reply('❌ Live session removal is not available in this build.');
    }

    const result = await hook(identifier);
    if (!result.ok) {
      try { await extra.react('⚠️'); } catch (_) {}
      if (result.reason === 'unknown') {
        return extra.reply(`❌ No session matches *"${identifier}"*.\nRun *.bots* to see the registered sessions.`);
      }
      return extra.reply(`❌ Could not remove the session: ${result.reason || 'unknown error'}`);
    }

    try { await extra.react('✅'); } catch (_) {}
    const removed = result.removed || {};
    const label = removed.phone
      ? `📱 Phone: ${removed.phone}`
      : `🆔 Id: ${removed.id}`;
    const persistNote = result.persisted
      ? ''
      : '\n⚠️ Not written to .env (no JUNE_SESSIONS line in the file) — update your panel env too.';
    return extra.reply(
      `🗑️ *Bot permanently deleted*\n${label}\n\n` +
      `Registry entry, authentication and bot-specific stored data were removed.\n` +
      `Adding this number again will require a fresh pairing.${persistNote}`
    );
  },
};
