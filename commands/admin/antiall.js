/**
 * AntiAll Command
 * Turn ALL anti-* group protection features ON or OFF at once.
 * .antiall on   → enables every anti feature with default settings
 * .antiall off  → disables every anti feature
 * .antiall      → shows current status of all features
 */

const fs   = require('fs');
const path = require('path');
const database = require('../../database');

const ANTIBOT_PATH   = path.join(__dirname, '../../data/antibot.json');
const ANTIDEL_PATH   = path.join(__dirname, '../../data/antidelete.json');
const ANTIEDIT_PATH  = path.join(__dirname, '../../data/antiedit.json');

function loadJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, '{}');
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch { return {}; }
}

function saveJson(filePath, data) {
  try { fs.writeFileSync(filePath, JSON.stringify(data, null, 2)); } catch {}
}

// All features that live in database.updateGroupSettings
// key = database field name, label = display name
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
      const gs       = database.getGroupSettings(from);
      const botCfg   = loadJson(ANTIBOT_PATH);
      const delCfg   = loadJson(ANTIDEL_PATH);

      const icon = (v) => v ? '✅' : '❌';

      const lines = DB_FEATURES.map(f => `  ${icon(gs[f.key])} ${f.label}`);

      const editCfg  = loadJson(ANTIEDIT_PATH);
      lines.push(`  ${icon(botCfg[from]?.enabled)} 🤖 Anti-Bot`);
      lines.push(`  ${icon(delCfg['_global']?.mode && delCfg['_global'].mode !== 'off')} 🗑️ Anti-Delete`);
      lines.push(`  ${icon(editCfg[from]?.mode && editCfg[from].mode !== 'off')} ✏️ Anti-Edit`);

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

      const botCfg = loadJson(ANTIBOT_PATH);
      botCfg[from] = { ...(botCfg[from] || {}), enabled: true };
      saveJson(ANTIBOT_PATH, botCfg);

      const delCfg = loadJson(ANTIDEL_PATH);
      delCfg['_global'] = { mode: 'chat' };
      saveJson(ANTIDEL_PATH, delCfg);

      const editCfgOn = loadJson(ANTIEDIT_PATH);
      editCfgOn[from] = { ...(editCfgOn[from] || {}), mode: 'chat' };
      saveJson(ANTIEDIT_PATH, editCfgOn);

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

      const botCfg = loadJson(ANTIBOT_PATH);
      botCfg[from] = { ...(botCfg[from] || {}), enabled: false };
      saveJson(ANTIBOT_PATH, botCfg);

      const delCfg = loadJson(ANTIDEL_PATH);
      delete delCfg['_global'];
      saveJson(ANTIDEL_PATH, delCfg);

      const editCfgOff = loadJson(ANTIEDIT_PATH);
      editCfgOff[from] = { ...(editCfgOff[from] || {}), mode: 'off' };
      saveJson(ANTIEDIT_PATH, editCfgOff);

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
