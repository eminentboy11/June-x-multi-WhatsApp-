/**
 * Autoread — automatically blue-tick messages
 * Modes: off | pm | group | on (both)
 * Settings persisted in database/bot-settings.json via database.js
 */
const db = require('../../database');

const KEY = 'autoReadMode';

function load() {
  return { mode: db.getBotSetting(KEY) || 'off' };
}

function save(data) {
  db.setBotSetting(KEY, data.mode || 'off');
}

module.exports = {
  name: 'autoread',
  aliases: ['autobluetick', 'autobt', 'autotick'],
  category: 'owner',
  description: 'Automatically blue-tick messages',
  usage: '.autoread <on/off/pm/group>',
  ownerOnly: true,

  async execute(sock, msg, args, extra) {
    const sub     = (args[0] || '').toLowerCase();
    const current = load().mode;

    const label = (m) => ({
      off:   '❌ OFF',
      pm:    '💬 PM only',
      group: '👥 Groups only',
      on:    '✅ ON (PM + Groups)',
    }[m] || '❌ OFF');

    if (!sub) {
      return extra.reply(
        `👁️ *Auto Read (Blue Tick)*\n` +
        `━━━━━━━━━━━━━━━\n` +
        `Status: *${label(current)}*\n\n` +
        `*Options:*\n` +
        `  .autoread on    — blue-tick all messages\n` +
        `  .autoread pm    — blue-tick DMs only\n` +
        `  .autoread group — blue-tick groups only\n` +
        `  .autoread off   — disable`
      );
    }

    if (!['on', 'off', 'pm', 'group'].includes(sub)) {
      return extra.reply('⚠️ Usage: .autoread on / off / pm / group');
    }

    save({ mode: sub });

    // Keep runtime config in sync
    try {
      const config = require('../../config');
      config.autoRead = (sub === 'on' || sub === 'group');
    } catch (_) {}

    return extra.reply(`👁️ *Auto Read* set to *${label(sub)}*`);
  }
};
