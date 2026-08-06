/**
 * Shared presence settings — backed by database via database.js
 * Mode  : 'off' | 'typing' | 'recording' | 'recordtype'
 * Scope : 'all' | 'pm' | 'group'  (ignored when mode === 'off')
 */
const db = require('../database');

const MODE_KEY  = 'presenceMode';
const SCOPE_KEY = 'presenceScope';

// ── Mode ─────────────────────────────────────────────────────────────────────

function getMode() {
  return db.getBotSetting(MODE_KEY) || 'off';
}

function setMode(mode) {
  db.setBotSetting(MODE_KEY, mode);
}

// ── Scope ────────────────────────────────────────────────────────────────────

function getScope() {
  return db.getBotSetting(SCOPE_KEY) || 'all';
}

function setScope(scope) {
  db.setBotSetting(SCOPE_KEY, scope);
}

// ── Helper: should presence fire for this chat? ───────────────────────────────
// isGroup: boolean — true when the chat is a group JID

function shouldSendPresence(isGroup) {
  const mode  = getMode();
  const scope = getScope();
  if (mode === 'off') return false;
  if (scope === 'pm')    return !isGroup;
  if (scope === 'group') return  isGroup;
  return true; // 'all'
}

// ── Legacy load/save (kept for back-compat) ───────────────────────────────────

function load() {
  return { mode: getMode(), scope: getScope() };
}

function save(data) {
  if (data.mode  !== undefined) setMode(data.mode);
  if (data.scope !== undefined) setScope(data.scope);
}

module.exports = { load, save, getMode, setMode, getScope, setScope, shouldSendPresence };
