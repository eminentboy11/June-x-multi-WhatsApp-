/**
 * DelBot Command - Hot-remove a session while the bot is running
 * (PLATFORM-LEVEL — Super Owner only)
 *
 * Usage: .delbot <phone|id>
 *
 * Removes the entry from the JUNE_SESSIONS registry and reuses the existing
 * reconciliation pipeline — ONLY that session stops (socket, timers, database
 * handle, adapter pools); every other session keeps running untouched.
 */

module.exports = {
  name: 'delbot',
  aliases: ['removesession', 'rmbot', 'deletebot'],
  category: 'owner',
  description: 'Remove a bot session from the running process (hot-remove)',
  usage: '.delbot <phone|id>',
  superOwnerOnly: true,

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
      `🗑️ *Session removed*\n${label}\n\n` +
      `Only that session stops — every other session keeps running.${persistNote}`
    );
  },
};
