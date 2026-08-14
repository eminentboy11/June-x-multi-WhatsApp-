/**
 * Shared presence settings — backed by SQLite bot_settings via database.js.
 *
 * Modes:  'off' | 'typing' | 'recording' | 'recordtype'
 * Scopes: 'pm' | 'group' (stored independently, so e.g. typing can be on in
 *         PMs while recording is on in groups).
 *
 * Backward compatible: a legacy single 'presenceMode' key is migrated to both
 * scopes on first read.
 */
const db = require('../database');

const KEY_PM = 'presencePm';
const KEY_GROUP = 'presenceGroup';
const KEY_LEGACY = 'presenceMode';
const VALID = new Set(['off', 'typing', 'recording', 'recordtype']);

const LABELS = {
  off: 'off',
  typing: '⌨️ typing',
  recording: '🎙️ recording',
  recordtype: '🎙️⌨️ record+type',
};

const isSet = (x) => x !== undefined && x !== null && x !== '';
const normalize = (v) => (VALID.has(v) ? v : 'off');

function ensureMigrated() {
  if (isSet(db.getBotSetting(KEY_PM)) || isSet(db.getBotSetting(KEY_GROUP))) return;
  const legacy = db.getBotSetting(KEY_LEGACY);
  if (!isSet(legacy)) return;
  const seed = normalize(legacy);
  try { db.setBotSetting(KEY_PM, seed); } catch (_) {}
  try { db.setBotSetting(KEY_GROUP, seed); } catch (_) {}
}

function getModes() {
  ensureMigrated();
  return {
    pm: normalize(db.getBotSetting(KEY_PM)),
    group: normalize(db.getBotSetting(KEY_GROUP)),
  };
}

function getModeFor(jid) {
  const { pm, group } = getModes();
  return (jid && String(jid).endsWith('@g.us')) ? group : pm;
}

function setPmMode(mode) { try { db.setBotSetting(KEY_PM, normalize(mode)); } catch (_) {} }
function setGroupMode(mode) { try { db.setBotSetting(KEY_GROUP, normalize(mode)); } catch (_) {} }

// Back-compat: single summary value (prefers group when set, else pm).
function getMode() {
  const { pm, group } = getModes();
  return group !== 'off' ? group : pm;
}
function setMode(mode) {
  const m = normalize(mode);
  setPmMode(m);
  setGroupMode(m);
}

function labelOf(m) { return LABELS[m] || m || 'off'; }

/**
 * Shared command logic for .autotyping / .autorecording / .autorecordtype.
 * Supports scope: pm | group | all | on | off, plus "<scope> off" to disable
 * just one scope.
 */
async function runPresenceCommand({ name, mode, args, extra, emoji, label }) {
  const a = (args || []).map((s) => String(s).toLowerCase());
  const scopeArg = a[0];
  const actionArg = a[1];
  const modes = getModes();

  if (!scopeArg) {
    return extra.reply(
      `${emoji} *${label}*\n` +
      `📱 PM     : *${labelOf(modes.pm)}*\n` +
      `👥 Group  : *${labelOf(modes.group)}*\n\n` +
      `Usage:\n` +
      `• .${name} pm     → enable in PMs\n` +
      `• .${name} group  → enable in groups\n` +
      `• .${name} all    → enable everywhere\n` +
      `• .${name} on     → enable everywhere\n` +
      `• .${name} off    → disable everywhere\n` +
      `• .${name} pm off → disable in PMs only`
    );
  }

  let targetScope = 'all';
  let turnOn = true;

  if (scopeArg === 'off') { targetScope = 'all'; turnOn = false; }
  else if (scopeArg === 'on' || scopeArg === 'all') { targetScope = 'all'; turnOn = true; }
  else if (scopeArg === 'pm' || scopeArg === 'group') {
    targetScope = scopeArg;
    turnOn = actionArg !== 'off';
  } else {
    return extra.reply(`⚠️ Usage: .${name} pm|group|all|on|off`);
  }

  const newMode = turnOn ? mode : 'off';
  if (targetScope === 'all') { setPmMode(newMode); setGroupMode(newMode); }
  else if (targetScope === 'pm') setPmMode(newMode);
  else setGroupMode(newMode);

  const scopeText = targetScope === 'all' ? 'PM + Group' : (targetScope === 'pm' ? 'PM' : 'Group');
  const stateText = turnOn ? `ON — ${labelOf(mode)}` : 'OFF';
  return extra.reply(`${emoji} *${label}* set to *${stateText}* for *${scopeText}*.`);
}

module.exports = {
  getModes, getModeFor, setPmMode, setGroupMode, getMode, setMode, runPresenceCommand, labelOf,
};
