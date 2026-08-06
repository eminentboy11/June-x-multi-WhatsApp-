/**
 * autorecording — show fake audio-recording presence before every bot response
 * Scopes: pm (DMs only) | groups (groups only) | on (all chats) | off (disabled)
 */
const { getMode, setMode, getScope, setScope } = require('../../utils/presenceSettings');

function label(mode, scope) {
  if (mode !== 'recording') return '🔴 OFF';
  if (scope === 'pm')       return '💬 PM only';
  if (scope === 'group')    return '👥 Groups only';
  return '✅ ON (all chats)';
}

module.exports = {
  name: 'autorecording',
  aliases: ['autorecord', 'record'],
  category: 'owner',
  description: 'Show fake audio-recording presence before every bot response',
  usage: '.autorecording <on/pm/groups/off>',
  ownerOnly: true,

  async execute(sock, msg, args, extra) {
    const sub      = (args[0] || '').toLowerCase();
    const curMode  = getMode();
    const curScope = getScope();

    if (!sub) {
      return extra.reply(
        `🎙️ *Auto Recording*\n` +
        `━━━━━━━━━━━━━━━\n` +
        `Status: *${label(curMode, curScope)}*\n\n` +
        `*Options:*\n` +
        `  .autorecording on     — enable in all chats\n` +
        `  .autorecording pm     — enable in PMs only\n` +
        `  .autorecording groups — enable in groups only\n` +
        `  .autorecording off    — disable`
      );
    }

    if (sub === 'off') {
      if (curMode === 'recording') setMode('off');
      return extra.reply('❌ *Auto Recording* disabled');
    }

    if (sub === 'on') {
      setMode('recording');
      setScope('all');
      return extra.reply('✅ *Auto Recording* enabled in *all chats*');
    }

    if (sub === 'pm') {
      setMode('recording');
      setScope('pm');
      return extra.reply('🎙️ *Auto Recording* enabled in *PMs only*');
    }

    if (sub === 'groups') {
      setMode('recording');
      setScope('group');
      return extra.reply('🎙️ *Auto Recording* enabled in *groups only*');
    }

    return extra.reply('⚠️ Usage: .autorecording on / pm / groups / off');
  }
};
