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
 * Simple mode selector: pm|dms = PM only, gc|group = groups only,
 * all = PM + groups, off = disabled everywhere.
 */
async function runPresenceCommand({ name, mode, args, extra, emoji, label }) {
  const a = (args || []).map((s) => String(s).toLowerCase());
  const scopeArg = a[0];
  const modes = getModes();

  if (!scopeArg) {
    return extra.reply(
      `${emoji} *${label}*\n\n` +
      `📱 PM       : ${labelOf(modes.pm)}\n` +
      `👥 Group    : ${labelOf(modes.group)}\n\n` +
      `Usage:\n` +
      `• .${name} pm     → PM only\n` +
      `• .${name} gc     → Groups only\n` +
      `• .${name} all    → PM + Groups\n` +
      `• .${name} off    → Disable\n` +
      `_(aliases: dms = pm, group = gc)_`
    );
  }

  let newPm, newGroup, scopeText;
  if (scopeArg === 'off') {
    newPm = 'off'; newGroup = 'off'; scopeText = 'everywhere';
  } else if (scopeArg === 'all') {
    newPm = mode; newGroup = mode; scopeText = 'PM + Groups';
  } else if (scopeArg === 'pm' || scopeArg === 'dms') {
    newPm = mode; newGroup = 'off'; scopeText = 'PM only';
  } else if (scopeArg === 'group' || scopeArg === 'gc') {
    newGroup = mode; newPm = 'off'; scopeText = 'Groups only';
  } else {
    return extra.reply(`⚠️ Usage: .${name} pm|gc|all|off`);
  }

  setPmMode(newPm);
  setGroupMode(newGroup);

  if (scopeArg === 'off') {
    return extra.reply(`${emoji} *${label}* disabled ${scopeText}.`);
  }
  return extra.reply(`${emoji} *${label}* enabled for *${scopeText}* (${labelOf(mode)}).`);
}

module.exports = {
  getModes, getModeFor, setPmMode, setGroupMode, getMode, setMode, runPresenceCommand, labelOf,
};
