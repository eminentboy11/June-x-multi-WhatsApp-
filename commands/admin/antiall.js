'use strict';

/**
 * AntiAll Command
 *
 * Enables/disables the group-scoped protection bundle and the AntiAll master
 * gate. Global owner settings (AntiDelete, AntiEdit, AntiDeleteStatus) remain
 * global and are intentionally not changed from a group command.
 *
 * Every setting in this module is stored in SQLite through database.js.
 */

const database = require('../../database');

// Flat group-settings fields already used by their respective group handlers.
const GROUP_FEATURES = [
  { key: 'antilink',          label: '🔗 Anti-Link' },
  { key: 'antiSpam',          label: '🛡️ Anti-Spam' },
  { key: 'antiimage',         label: '🖼️ Anti-Image' },
  { key: 'antiaudio',         label: '🔇 Anti-Audio' },
  { key: 'antisticker',       label: '🎭 Anti-Sticker' },
  { key: 'antitag',           label: '📛 Anti-Tag' },
  { key: 'antibot',           label: '🤖 Anti-Bot' },
  { key: 'antigroupmention',  label: '📌 Anti-Group Mention' },
  { key: 'antigroupstatus',   label: '🛡️ Anti-Group Status' },
  { key: 'antidemote',        label: '⬇️ Anti-Demote' },
  { key: 'antipromote',       label: '⬆️ Anti-Promote' },
  { key: 'antiviewonce',      label: '👁️ Anti-View-Once' },
];

const icon = (value) => value ? '✅' : '❌';
const modeLabel = (mode) => mode === 'off' ? '❌ OFF' : `✅ ${mode}`;

function getStatus(from) {
  const groupSettings = database.getGroupSettings(from);
  const antiTagAdmins = database.getAntiTagAdminsSettings(from);

  return {
    groupSettings,
    antiAll: database.isAntiAllEnabled(from),
    antiTagAdmins,
    antiDeleteMode: database.getAntideleteMode(),
    antiEditMode: database.getAntieditMode(),
    antiDeleteStatus: database.isAntideleteStatusEnabled(),
  };
}

function setGroupProtectionBundle(from, enabled) {
  const groupSettings = database.getGroupSettings(from);
  for (const feature of GROUP_FEATURES) groupSettings[feature.key] = enabled;

  database.updateGroupSettings(from, groupSettings);
  database.setAntiAllEnabled(from, enabled);
  database.setAntiTagAdminsSettings(from, { enabled });
}

module.exports = {
  name: 'antiall',
  aliases: ['allanti', 'antialll'],
  category: 'admin',
  description: 'Enable/disable the AntiAll group master and group protections',
  usage: '.antiall on/off',
  groupOnly: true,
  adminOnly: true,
  botAdminNeeded: true,

  async execute(sock, msg, args, extra) {
    const { from, reply } = extra;
    const sub = (args[0] || '').toLowerCase();

    if (!sub) {
      const status = getStatus(from);
      const lines = [
        `  ${icon(status.antiAll)} ⛔ AntiAll Master (blocks non-admin/non-owner messages)`,
        ...GROUP_FEATURES.map(feature => `  ${icon(status.groupSettings[feature.key])} ${feature.label}`),
        `  ${icon(status.antiTagAdmins.enabled)} 🛡️ Anti-Tag Admins${status.antiTagAdmins.enabled ? ` — ${status.antiTagAdmins.action}` : ''}`,
      ];

      return reply(
        `🛡️ *AntiAll — Group Protection Status*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        lines.join('\n') +
        `\n━━━━━━━━━━━━━━━━━━━━\n` +
        `*Global owner settings — not changed by .antiall:*\n` +
        `  🗑️ Anti-Delete: ${modeLabel(status.antiDeleteMode)}\n` +
        `  ✏️ Anti-Edit: ${modeLabel(status.antiEditMode)}\n` +
        `  📸 Anti-Delete Status: ${icon(status.antiDeleteStatus)}\n\n` +
        `*Commands:*\n` +
        `  .antiall on  — enable the group bundle + master\n` +
        `  .antiall off — disable the group bundle + master`
      );
    }

    if (sub === 'on') {
      setGroupProtectionBundle(from, true);
      const antiTagAdmins = database.getAntiTagAdminsSettings(from);
      return reply(
        `✅ *AntiAll — Group Protections ENABLED*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `  ✅ ⛔ AntiAll Master\n` +
        GROUP_FEATURES.map(feature => `  ✅ ${feature.label}`).join('\n') + '\n' +
        `  ✅ 🛡️ Anti-Tag Admins — ${antiTagAdmins.action}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `_Global Anti-Delete, Anti-Edit, and Anti-Delete Status settings were not changed._`
      );
    }

    if (sub === 'off') {
      setGroupProtectionBundle(from, false);
      return reply(
        `❌ *AntiAll — Group Protections DISABLED*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `  ❌ ⛔ AntiAll Master\n` +
        GROUP_FEATURES.map(feature => `  ❌ ${feature.label}`).join('\n') + '\n' +
        `  ❌ 🛡️ Anti-Tag Admins\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `_Global Anti-Delete, Anti-Edit, and Anti-Delete Status settings were not changed._`
      );
    }

    return reply('⚠️ Usage: .antiall on | off\nNo argument shows current status.');
  },
};
