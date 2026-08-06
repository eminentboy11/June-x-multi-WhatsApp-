/**
 * autotyping — show fake typing presence before every bot response
 * Scopes: pm (DMs only) | groups (groups only) | on (all chats) | off (disabled)
 */
const { getMode, setMode, getScope, setScope } = require('../../utils/presenceSettings');

function label(mode, scope) {
  if (mode !== 'typing') return '🔴 OFF';
  if (scope === 'pm')    return '💬 PM only';
  if (scope === 'group') return '👥 Groups only';
  return '✅ ON (all chats)';
}

module.exports = {
  name: 'autotyping',
  aliases: ['autotext', 'faketyping'],
  category: 'owner',
  description: 'Show fake typing presence before every bot response',
  usage: '.autotyping <on/pm/groups/off>',
  ownerOnly: true,

  async execute(sock, msg, args, extra) {
    const sub     = (args[0] || '').toLowerCase();
    const curMode = getMode();
    const curScope = getScope();

    if (!sub) {
      return extra.reply(
        `⌨️ *Auto Typing*\n` +
        `━━━━━━━━━━━━━━━\n` +
        `Status: *${label(curMode, curScope)}*\n\n` +
        `*Options:*\n` +
        `  .autotyping on     — enable in all chats\n` +
        `  .autotyping pm     — enable in PMs only\n` +
        `  .autotyping groups — enable in groups only\n` +
        `  .autotyping off    — disable`
      );
    }

    if (sub === 'off') {
      if (curMode === 'typing') setMode('off');
      return extra.reply('❌ *Auto Typing* disabled');
    }

    if (sub === 'on') {
      setMode('typing');
      setScope('all');
      return extra.reply('✅ *Auto Typing* enabled in *all chats*');
    }

    if (sub === 'pm') {
      setMode('typing');
      setScope('pm');
      return extra.reply('💬 *Auto Typing* enabled in *PMs only*');
    }

    if (sub === 'groups') {
      setMode('typing');
      setScope('group');
      return extra.reply('👥 *Auto Typing* enabled in *groups only*');
    }

    return extra.reply('⚠️ Usage: .autotyping on / pm / groups / off');
  }
};
