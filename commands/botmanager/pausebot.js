'use strict';

module.exports = {
  name: 'pausebot',
  aliases: ['pause', 'stopbot'],
  category: 'botmanager',
  description: 'Temporarily stop a bot while preserving auth and configuration',
  usage: '.pausebot <phone|id>',
  superOwnerOnly: true,
  superOwnerSessionOnly: true,

  async execute(sock, msg, args, extra) {
    const identifier = String(args[0] || '').trim();
    if (!identifier) {
      return extra.reply('⚠️ *Usage:* .pausebot <phone|id>\n\nExample: .pausebot 2348165321909');
    }

    const hook = global.__JUNE_PAUSE_SESSION;
    if (typeof hook !== 'function') {
      return extra.reply('❌ Session pause is not available in this build.');
    }

    const result = await hook(identifier);
    if (!result.ok) {
      if (result.reason === 'unknown') {
        return extra.reply(`❌ No session matches *${identifier}*. Run *.bots* to check ids.`);
      }
      if (result.reason === 'already-paused') {
        return extra.reply(`⏸️ Session *${result.id || identifier}* is already paused.`);
      }
      if (result.reason === 'control-session') {
        return extra.reply('🛡️ The Super Owner control session cannot be paused; it is required to resume other bots.');
      }
      return extra.reply(`❌ Could not pause session: ${result.reason || 'unknown error'}`);
    }

    try { await extra.react('⏸️'); } catch (_) {}
    const persistNote = result.persisted ? '' : '\n⚠️ Update the panel/root JUNE_SESSIONS registry too.';
    return extra.reply(
      `⏸️ *Bot paused*\n` +
      `🆔 Session: ${result.id}\n\n` +
      `Authentication and configuration were preserved.\n` +
      `Use *.resumebot ${result.id}* to reconnect without pairing.${persistNote}`
    );
  },
};
