/**
 * autorecordtype — show fake recording-then-typing presence before every bot response
 * Scopes: pm (DMs only) | groups (groups only) | on (all chats) | off (disabled)
 */
const { getMode, setMode, getScope, setScope } = require('../../utils/presenceSettings');

function label(mode, scope) {
  if (mode !== 'recordtype') return '🔴 OFF';
  if (scope === 'pm')        return '💬 PM only';
  if (scope === 'group')     return '👥 Groups only';
  return '✅ ON (all chats)';
}

module.exports = {
  name: 'autorecordtype',
  aliases: ['recordtype', 'fakerecordtype'],
  category: 'owner',
  description: 'Show fake recording-then-typing presence before every bot response',
  usage: '.autorecordtype <on/pm/groups/off>',
  ownerOnly: true,

  async execute(sock, msg, args, extra) {
    const sub      = (args[0] || '').toLowerCase();
    const curMode  = getMode();
    const curScope = getScope();

    if (!sub) {
      return extra.reply(
        `🎙️⌨️ *Auto Record+Type*\n` +
        `━━━━━━━━━━━━━━━\n` +
        `Status: *${label(curMode, curScope)}*\n\n` +
        `*Options:*\n` +
        `  .autorecordtype on     — enable in all chats\n` +
        `  .autorecordtype pm     — enable in PMs only\n` +
        `  .autorecordtype groups — enable in groups only\n` +
        `  .autorecordtype off    — disable`
      );
    }

    if (sub === 'off') {
      if (curMode === 'recordtype') setMode('off');
      return extra.reply('❌ *Auto Record+Type* disabled');
    }

    if (sub === 'on') {
      setMode('recordtype');
      setScope('all');
      return extra.reply('✅ *Auto Record+Type* enabled in *all chats*');
    }

    if (sub === 'pm') {
      setMode('recordtype');
      setScope('pm');
      return extra.reply('🎙️⌨️ *Auto Record+Type* enabled in *PMs only*');
    }

    if (sub === 'groups') {
      setMode('recordtype');
      setScope('group');
      return extra.reply('🎙️⌨️ *Auto Record+Type* enabled in *groups only*');
    }

    return extra.reply('⚠️ Usage: .autorecordtype on / pm / groups / off');
  }
};
