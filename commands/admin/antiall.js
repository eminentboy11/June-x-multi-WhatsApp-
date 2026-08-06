/**
 * AntiAll Command
 * Turn ALL anti-* group protection features ON or OFF at once.
 * .antiall on   → enables every anti feature with default settings
 * .antiall off  → disables every anti feature
 * .antiall      → shows current status of all features
 */

const database = require(require('path').join(global.__CORE__, 'database'));
const kv       = require('../../utils/kvstore');

// All features that live in database.updateGroupSettings
const DB_FEATURES = [
  { key: 'antilink',         label: '🔗 Anti-Link' },
  { key: 'antiSpam',         label: '🛡️ Anti-Spam' },
  { key: 'antiimage',        label: '🖼️ Anti-Image' },
  { key: 'antiaudio',        label: '🔇 Anti-Audio' },
  { key: 'antisticker',      label: '🎭 Anti-Sticker' },
  { key: 'antitag',          label: '📛 Anti-Tag' },
  { key: 'antigroupmention', label: '📌 Anti-Group Mention' },
  { key: 'antigroupstatus',  label: '🛡️ Anti-Group Status' },
  { key: 'antidemote',       label: '⬇️ Anti-Demote' },
  { key: 'antipromote',      label: '⬆️ Anti-Promote' },
  { key: 'antiviewonce',     label: '👁️ Anti-View-Once' },
];

module.exports = {
  name: 'antiall',
  aliases: ['allanti', 'antialll'],
  category: 'admin',
  description: 'Enable or disable ALL anti-* group protection features at once',
  usage: '.antiall on/off',
  groupOnly: true,
  adminOnly: true,
  botAdminNeeded: true,

  async execute(sock, msg, args, extra) {
    const { from, reply } = extra;
    const sub = (args[0] || '').toLowerCase();

    // ── STATUS (no args) ────────────────────────────────────────────────────
    if (!sub) {
      const gs     = database.getGroupSettings(from);
      const botCfg = kv.get('antibot', from, {});
      const delCfg = kv.get('antidelete', '_global', {});
      const edtCfg = kv.get('antiedit', '_global', { mode: 'off' });

      const icon = (v) => v ? '✅' : '❌';

      const lines = DB_FEATURES.map(f => `  ${icon(gs[f.key])} ${f.label}`);

      const delMode = delCfg['_global']?.mode || delCfg.mode;
      lines.push(`  ${icon(botCfg.enabled)} 🤖 Anti-Bot`);
      lines.push(`  ${icon(delMode && delMode !== 'off')} 🗑️ Anti-Delete`);
      lines.push(`  ${icon(edtCfg.mode && edtCfg.mode !== 'off')} ✏️ Anti-Edit`);

      return reply(
        `🛡️ *AntiAll — Group Protection Status*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        lines.join('\n') +
        `\n━━━━━━━━━━━━━━━━━━━━\n` +
        `*Commands:*\n` +
        `  .antiall on  — enable all\n` +
        `  .antiall off — disable all`
      );
    }

    // ── ON ──────────────────────────────────────────────────────────────────
    if (sub === 'on') {
      const dbUpdate = {};
      DB_FEATURES.forEach(f => { dbUpdate[f.key] = true; });
      database.updateGroupSettings(from, dbUpdate);

      database.updateGroupSettings(from, { antibot: true });
      kv.set('antibot', from, { enabled: true });
      kv.set('antidelete', '_global', { '_global': { mode: 'chat' } });
      kv.set('antiedit', '_global', { mode: 'chat' });

      return reply(
        `✅ *AntiAll — All Protections ENABLED*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        DB_FEATURES.map(f => `  ✅ ${f.label}`).join('\n') + '\n' +
        `  ✅ 🤖 Anti-Bot\n` +
        `  ✅ 🗑️ Anti-Delete (chat mode)\n` +
        `  ✅ ✏️ Anti-Edit (chat mode)\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `_All group protections are now active with default settings._`
      );
    }

    // ── OFF ─────────────────────────────────────────────────────────────────
    if (sub === 'off') {
      const dbUpdate = {};
      DB_FEATURES.forEach(f => { dbUpdate[f.key] = false; });
      database.updateGroupSettings(from, dbUpdate);

      database.updateGroupSettings(from, { antibot: false });
      kv.set('antibot', from, { enabled: false });
      kv.set('antidelete', '_global', {});
      kv.set('antiedit', '_global', { mode: 'off' });

      return reply(
        `❌ *AntiAll — All Protections DISABLED*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        DB_FEATURES.map(f => `  ❌ ${f.label}`).join('\n') + '\n' +
        `  ❌ 🤖 Anti-Bot\n` +
        `  ❌ 🗑️ Anti-Delete\n` +
        `  ❌ ✏️ Anti-Edit\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `_All group protections have been turned off._`
      );
    }

    return reply('⚠️ Usage: .antiall on | off\nNo argument shows current status.');
  }
};
