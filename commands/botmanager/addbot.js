/**
 * AddBot Command - Hot-add a new session while the bot is running
 * (PLATFORM-LEVEL — Super Owner only)
 *
 * Usage: .addbot <phone> <sessionId?>
 *
 * LIVE FLOW (in the same chat where .addbot was run):
 *   .addbot 2348165321909
 *   → ⏳ reaction on the command message (no processing text spam)
 *   → 🔑 pairing-code message WITH buttons (Copy Code / Cancel)
 *   → terminal status in the same chat:
 *       ✅ Bot session connected!  (or ⚠️/❌ failure, limit, cancelled)
 *   → ✅ / ⚠️ final reaction on the original command message
 *
 * Existing hot-add pipeline reused — no second implementation, no restart,
 * existing sessions untouched. Quotas: JUNE_MAX_SESSIONS + WhatsApp's
 * 4-devices-per-number cap.
 */

const { validateSessionEntry, VALID_PREFIXES } = require('../../utils/core/sessionManager');
const { getCurrentBotId } = require('../../utils/core/botContext');

module.exports = {
  name: 'addbot',
  aliases: ['addsession', 'newbot'],
  category: 'botmanager',
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
      try { await extra.react('⚠️'); } catch (_) {}
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

    // 3) + 4) Register through the existing pipeline, tagged with the chat
    // that requested the add (the pairing code and status come back HERE).
    const hook = global.__JUNE_ADD_SESSION;
    if (typeof hook !== 'function') {
      try { await extra.react('⚠️'); } catch (_) {}
      return extra.reply('❌ Live session registration is not available in this build.');
    }

    const result = await hook({ phone: check.phone, sessionId: check.sessionId }, {
      chatJid: msg.key.remoteJid,
      viaBotId: getCurrentBotId(),
      quotedMsg: msg, // FULL message — Baileys' quote path needs quoted.message
    });

    if (!result.ok) {
      try { await extra.react('⚠️'); } catch (_) {}
      if (result.reason === 'duplicate') {
        return extra.reply(
          `❌ *Session already registered.*\n\n` +
          `A session with phone *${check.phone}*${check.sessionId ? ` or sessionId *${check.sessionId}*` : ''} already exists.\n` +
          `Remove the existing entry first (.delbot) or use a different number.`
        );
      }
      if (result.reason === 'quota') {
        return extra.reply(
          `⚠️ *Session limit reached* (${result.total}/${result.limit}).\n\n` +
          `Remove a session with *.delbot <phone>* first, or raise JUNE_MAX_SESSIONS on the server.`
        );
      }
      if (result.reason === 'device-limit') {
        return extra.reply(
          `⚠️ *Device limit for this number.*\n\n` +
          `This number already has ${result.limit} linked devices (WhatsApp's cap).\n` +
          `Unlink one in WhatsApp → Settings → Linked Devices, then try again.`
        );
      }
      return extra.reply(`❌ Could not add the session: ${result.reason || 'unknown error'}`);
    }

    // 5) Progress = reactions only. The pairing code message and the
    // terminal status arrive in this same chat automatically.
    try { await extra.react('⏳'); } catch (_) {}
    return null;
  },
};
