'use strict';

/**
 * ResetBot Command - Wipe the bot's database (owner only).
 * Aliases: resetdb
 *
 * Usage:
 *   .resetbot                       -> shows what will be wiped (safe, no changes)
 *   .resetbot confirm               -> resets DATA only (keeps the WhatsApp login)
 *   .resetbot confirm --session     -> also clears the login session (bot re-pairs)
 *
 * The reset clears both the local SQLite tables and the remote JuneDB mirror,
 * so the data does not get re-seeded on the next restart.
 */

const database = require('../../database');

const DATA_SCOPE = [
  'warnings', 'moderators', 'muted users', 'KV store', 'antidelete logs',
  'status-download history', 'group stats', 'group settings', 'user profiles',
  'chat profiles', 'LID map', 'runtime telemetry', 'bot settings', 'sync queue',
];

module.exports = {
  name: 'resetbot',
  aliases: ['resetdb'],
  category: 'owner',
  description: 'Wipe the bot database (data only by default; add --session to also log out).',
  usage: '.resetbot confirm [--session]',
  ownerOnly: true,

  async execute(sock, msg, args, extra) {
    try {
      const argSet = new Set((args || []).map((a) => String(a).toLowerCase()));
      const confirmed = argSet.has('confirm');
      const includeSession = argSet.has('--session') || argSet.has('--full') || argSet.has('-s');

      if (!confirmed) {
        return extra.reply(
          '⚠️ *DATABASE RESET — CONFIRMATION REQUIRED*\n\n' +
          'This permanently wipes the bot’s stored data:\n' +
          '• ' + DATA_SCOPE.join('\n• ') + '\n\n' +
          'The WhatsApp login session is kept by default.\n' +
          'Add *--session* to also clear the login (bot must re-pair).\n\n' +
          'To proceed, send: *.resetbot confirm*' +
          (includeSession ? ' *--session*' : '') + '\n\n' +
          '🔒 Owner only.'
        );
      }

      await extra.reply('🧹 Wiping database, please wait…');

      const result = await database.resetDatabase({ includeSession });

      const lines = [
        '✅ *Database reset complete*\n',
        '🗄️ *Local tables cleared:* ' + (result.localCleared ? result.localCleared.length : 0),
        '☁️ *Remote mirror cleared:* ' + (result.remote && result.remote.remoteCleared ? 'yes' : 'no / not configured'),
      ];
      if (includeSession) {
        lines.push('');
        lines.push('🔑 *Login session cleared* — the bot returns to the pairing screen on next reconnect/restart.');
      } else {
        lines.push('');
        lines.push('🔑 Login session kept — bot stays connected.');
      }
      lines.push('\n_Data will not return after a restart._');

      return extra.reply(lines.join('\n'));
    } catch (error) {
      console.error('ResetBot command error:', error);
      return extra.reply('❌ Failed to reset database: ' + (error && error.message ? error.message : error));
    }
  },
};
