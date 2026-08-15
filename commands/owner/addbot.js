/**
 * AddBot Command - Hot-add a new session while the bot is running (Owner Only)
 *
 * Usage: .addbot <phone> <sessionId?>
 *
 * Appends a validated entry to the existing JUNE_SESSIONS registry (the sole
 * session configuration source) and reuses the existing JUNE_SESSIONS
 * hot-reconciliation pipeline — no second hot-add implementation, no restart,
 * and existing sessions are never disturbed. Duplicate/conflicting sessions
 * (same phone = same storage identity, same sessionId = same credential) are
 * rejected.
 */

const { validateSessionEntry, VALID_PREFIXES } = require('../../utils/sessionManager');

module.exports = {
  name: 'addbot',
  aliases: ['addsession', 'newbot'],
  category: 'owner',
  description: 'Add a new bot session to the running process (hot-add)',
  usage: '.addbot <phone> <sessionId?>',
  // PLATFORM-LEVEL command: resolves against the persisted deployment
  // Super Owner (config.ownerNumber only during the bootstrap window).
  // This command can never create, replace, modify or promote a Super Owner.
  superOwnerOnly: true,

  async execute(sock, msg, args, extra) {
    const rawPhone = String(args[0] || '').trim();
    const rawSessionId = String(args[1] || '').trim();

    // 1) Validate the phone number.
    // 2) Validate the sessionId against the supported session-ID formats.
    const check = validateSessionEntry({ phone: rawPhone, sessionId: rawSessionId });
    if (!check.ok) {
      if (check.reason === 'invalid-phone') {
        return extra.reply(
          '⚠️ *Invalid phone number.*\n\n' +
          'Usage: .addbot <phone> <sessionId?>\n' +
          'Example: .addbot 2348165321909 JUNE-MD:~xxxxx\n\n' +
          '_(phone = digits with country code; sessionId is optional — without it the bot uses pairing-code login)_'
        );
      }
      return extra.reply(
        `⚠️ *Invalid sessionId format.*\n\n` +
        `Accepted prefixes: ${VALID_PREFIXES.join(', ')}\n\n` +
        `Leave the sessionId out to use pairing-code login instead.`
      );
    }

    // 3) + 4) Register through the existing pipeline (index.js hook).
    const hook = global.__JUNE_ADD_SESSION;
    if (typeof hook !== 'function') {
      return extra.reply('❌ Live session registration is not available in this build.');
    }

    const result = await hook({ phone: check.phone, sessionId: check.sessionId });
    if (!result.ok) {
      if (result.reason === 'duplicate') {
        return extra.reply(
          `❌ *Session already registered.*\n\n` +
          `A session with phone *${check.phone}*${check.sessionId ? ` or sessionId *${check.sessionId}*` : ''} already exists.\n` +
          `Remove the existing entry from JUNE_SESSIONS first, or use a different number.`
        );
      }
      return extra.reply(`❌ Could not add the session: ${result.reason || 'unknown error'}`);
    }

    // 5) Concise confirmation. The session manager takes over from here.
    const persistNote = result.persisted
      ? ''
      : '\n⚠️ Not written to .env (no JUNE_SESSIONS line in the file) — add it to your panel env to survive restarts.';
    return extra.reply(
      '✅ *Bot session added*\n' +
      `📱 Phone: ${check.phone}\n` +
      `🔑 Session: ${check.sessionId || '(pairing-code login)'}\n` +
      `🟢 Status: Starting...${persistNote}`
    );
  },
};
