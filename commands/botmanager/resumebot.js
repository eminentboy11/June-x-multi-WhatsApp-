'use strict';

module.exports = {
  name: 'resumebot',
  aliases: ['resume', 'startbot'],
  category: 'botmanager',
  description: 'Resume a paused bot using its preserved authentication',
  usage: '.resumebot <phone|id>',
  superOwnerOnly: true,
  superOwnerSessionOnly: true,

  async execute(sock, msg, args, extra) {
    const identifier = String(args[0] || '').trim();
    if (!identifier) {
      return extra.reply('⚠️ *Usage:* .resumebot <phone|id>\n\nExample: .resumebot 2348165321909');
    }

    const hook = global.__JUNE_RESUME_SESSION;
    if (typeof hook !== 'function') {
      return extra.reply('❌ Session resume is not available in this build.');
    }

    const result = await hook(identifier);
    if (!result.ok) {
      if (result.reason === 'unknown') {
        return extra.reply(`❌ No session matches *${identifier}*. Run *.bots* to check ids.`);
      }
      if (result.reason === 'already-active') {
        return extra.reply(`🟢 Session *${result.id || identifier}* is already active.`);
      }
      return extra.reply(`❌ Could not resume session: ${result.reason || 'unknown error'}`);
    }

    try { await extra.react('▶️'); } catch (_) {}
    const persistNote = result.persisted ? '' : '\n⚠️ Update the panel/root JUNE_SESSIONS registry too.';
    return extra.reply(
      `▶️ *Bot resume started*\n` +
      `🆔 Session: ${result.id}\n\n` +
      `Stored authentication is being reused; no pairing should be required.${persistNote}`
    );
  },
};
