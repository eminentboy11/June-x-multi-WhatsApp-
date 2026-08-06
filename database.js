/**
 * SQLite-backed Database for June X Ultra
 * Drop-in replacement for the previous JSON-file implementation.
 * Uses better-sqlite3 (synchronous API — no change to callers).
 */

'use strict';

const path     = require('path');
const fs       = require('fs');
const Database = require('better-sqlite3');
const config   = require('./config');

const DB_DIR  = path.join(__dirname, 'database');
const DB_FILE = path.join(DB_DIR, 'june-ultra.db');

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_FILE);

// Performance tuning
db.pragma('journal_mode = WAL');
db.pragma('synchronous  = NORMAL');
db.pragma('cache_size   = -16000');   // 16 MB page cache
db.pragma('foreign_keys = ON');

// ── Schema ────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS groups (
    group_id TEXT PRIMARY KEY,
    settings TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    data    TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS warnings (
    group_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    count    INTEGER NOT NULL DEFAULT 0,
    entries  TEXT    NOT NULL DEFAULT '[]',
    PRIMARY KEY (group_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS moderators (
    user_id TEXT PRIMARY KEY
  );

  CREATE TABLE IF NOT EXISTS muted_users (
    group_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    PRIMARY KEY (group_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS bot_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS session (
    id       INTEGER PRIMARY KEY DEFAULT 1,
    creds    TEXT,
    saved_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS group_stats (
    group_id TEXT NOT NULL,
    date     TEXT NOT NULL,
    data     TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (group_id, date)
  );

  CREATE TABLE IF NOT EXISTS chat_profiles (
    bot_id  TEXT NOT NULL,
    user_id TEXT NOT NULL,
    profile TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (bot_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS kv_store (
    namespace TEXT NOT NULL,
    key       TEXT NOT NULL,
    value     TEXT NOT NULL,
    PRIMARY KEY (namespace, key)
  );
`);

// ── Prepared statements ───────────────────────────────────────────────────────
const stmts = {
  // groups
  getGroup:    db.prepare('SELECT settings FROM groups WHERE group_id = ?'),
  upsertGroup: db.prepare('INSERT INTO groups (group_id, settings) VALUES (?, ?) ON CONFLICT(group_id) DO UPDATE SET settings = excluded.settings'),

  // users
  getUser:     db.prepare('SELECT data FROM users WHERE user_id = ?'),
  upsertUser:  db.prepare('INSERT INTO users (user_id, data) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data'),

  // warnings
  getWarnings: db.prepare('SELECT count, entries FROM warnings WHERE group_id = ? AND user_id = ?'),
  upsertWarn:  db.prepare('INSERT INTO warnings (group_id, user_id, count, entries) VALUES (?, ?, ?, ?) ON CONFLICT(group_id, user_id) DO UPDATE SET count = excluded.count, entries = excluded.entries'),
  delWarnings: db.prepare('DELETE FROM warnings WHERE group_id = ? AND user_id = ?'),

  // moderators
  getMods:   db.prepare('SELECT user_id FROM moderators'),
  addMod:    db.prepare('INSERT OR IGNORE INTO moderators (user_id) VALUES (?)'),
  delMod:    db.prepare('DELETE FROM moderators WHERE user_id = ?'),
  isMod:     db.prepare('SELECT 1 FROM moderators WHERE user_id = ?'),

  // muted
  muteUser:    db.prepare('INSERT OR IGNORE INTO muted_users (group_id, user_id) VALUES (?, ?)'),
  unmuteUser:  db.prepare('DELETE FROM muted_users WHERE group_id = ? AND user_id = ?'),
  isMuted:     db.prepare('SELECT 1 FROM muted_users WHERE group_id = ? AND user_id = ?'),
  getMuted:    db.prepare('SELECT user_id FROM muted_users WHERE group_id = ?'),

  // bot_settings
  getSetting:    db.prepare('SELECT value FROM bot_settings WHERE key = ?'),
  setSetting:    db.prepare('INSERT INTO bot_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
  getAllSettings: db.prepare('SELECT key, value FROM bot_settings'),

  // session
  getSession:   db.prepare('SELECT creds FROM session WHERE id = 1'),
  upsertSession: db.prepare('INSERT INTO session (id, creds, saved_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET creds = excluded.creds, saved_at = excluded.saved_at'),
  clearSession:  db.prepare('DELETE FROM session WHERE id = 1'),

  // kv_store
  getKV:  db.prepare('SELECT value FROM kv_store WHERE namespace = ? AND key = ?'),
  setKV:  db.prepare('INSERT INTO kv_store (namespace, key, value) VALUES (?, ?, ?) ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value'),
  delKV:  db.prepare('DELETE FROM kv_store WHERE namespace = ? AND key = ?'),
  allKV:  db.prepare('SELECT key, value FROM kv_store WHERE namespace = ?'),
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const parse  = (str, fallback = {}) => { try { return JSON.parse(str); } catch { return fallback; } };
const serial = (val) => JSON.stringify(val);

// ── Group Settings ────────────────────────────────────────────────────────────
const getGroupSettings = (groupId) => {
  const row = stmts.getGroup.get(groupId);
  if (row) return parse(row.settings, { ...config.defaultGroupSettings });
  const defaults = { ...config.defaultGroupSettings };
  stmts.upsertGroup.run(groupId, serial(defaults));
  return defaults;
};

const updateGroupSettings = (groupId, settings) => {
  const current = getGroupSettings(groupId);
  const updated  = { ...current, ...settings };
  stmts.upsertGroup.run(groupId, serial(updated));
  return true;
};

// ── User Data ─────────────────────────────────────────────────────────────────
const getUser = (userId) => {
  const row = stmts.getUser.get(userId);
  if (row) return parse(row.data);
  const defaults = { registered: Date.now(), premium: false, banned: false };
  stmts.upsertUser.run(userId, serial(defaults));
  return defaults;
};

const updateUser = (userId, data) => {
  const current = getUser(userId);
  stmts.upsertUser.run(userId, serial({ ...current, ...data }));
  return true;
};

// ── Warnings ──────────────────────────────────────────────────────────────────
const getWarnings = (groupId, userId) => {
  const row = stmts.getWarnings.get(groupId, userId);
  if (!row) return { count: 0, warnings: [] };
  return { count: row.count, warnings: parse(row.entries, []) };
};

const addWarning = (groupId, userId, reason) => {
  const current  = getWarnings(groupId, userId);
  current.count++;
  current.warnings.push({ reason, date: Date.now() });
  stmts.upsertWarn.run(groupId, userId, current.count, serial(current.warnings));
  return current;
};

const removeWarning = (groupId, userId) => {
  const current = getWarnings(groupId, userId);
  if (current.count <= 0) return false;
  current.count--;
  current.warnings.pop();
  stmts.upsertWarn.run(groupId, userId, current.count, serial(current.warnings));
  return true;
};

const clearWarnings = (groupId, userId) => {
  stmts.delWarnings.run(groupId, userId);
  return true;
};

// ── Moderators ────────────────────────────────────────────────────────────────
const getModerators = () => stmts.getMods.all().map(r => r.user_id);

const addModerator = (userId) => {
  if (!userId) return false;
  stmts.addMod.run(userId);
  return true;
};

const removeModerator = (userId) => {
  stmts.delMod.run(userId);
  return true;
};

const isModerator = (userId) => {
  if (stmts.isMod.get(userId)) return true;
  // LID reverse-mapping fallback
  const cfg         = require('./config');
  const sessionPath = path.join(__dirname, cfg.sessionName || 'session');
  const revFile     = path.join(sessionPath, `lid-mapping-${userId}_reverse.json`);
  try {
    if (fs.existsSync(revFile)) {
      const pn = JSON.parse(fs.readFileSync(revFile, 'utf8').trim());
      if (pn && stmts.isMod.get(String(pn))) return true;
    }
  } catch (_) {}
  return false;
};

// ── Bad Words ─────────────────────────────────────────────────────────────────
const getBadWords = (groupId) => {
  const s = getGroupSettings(groupId);
  return Array.isArray(s.badwords) ? s.badwords : [];
};

const addBadWord = (groupId, word) => {
  const settings = getGroupSettings(groupId);
  if (!Array.isArray(settings.badwords)) settings.badwords = [];
  const normalized = word.toLowerCase().trim();
  if (settings.badwords.includes(normalized)) return false;
  settings.badwords.push(normalized);
  stmts.upsertGroup.run(groupId, serial(settings));
  return true;
};

const removeBadWord = (groupId, word) => {
  const settings = getGroupSettings(groupId);
  if (!Array.isArray(settings.badwords)) return false;
  const normalized = word.toLowerCase().trim();
  const before = settings.badwords.length;
  settings.badwords = settings.badwords.filter(w => w !== normalized);
  if (settings.badwords.length === before) return false;
  stmts.upsertGroup.run(groupId, serial(settings));
  return true;
};

// ── Muted Users ───────────────────────────────────────────────────────────────
const norm = (userId) => userId.split('@')[0] + '@s.whatsapp.net';

const muteUser = (groupId, userId) => {
  stmts.muteUser.run(groupId, norm(userId));
  return true;
};

const unmuteUser = (groupId, userId) => {
  const info = db.prepare('DELETE FROM muted_users WHERE group_id = ? AND user_id = ?').run(groupId, norm(userId));
  return info.changes > 0;
};

const isUserMuted = (groupId, userId) => !!stmts.isMuted.get(groupId, norm(userId));

const getMutedUsers = (groupId) => stmts.getMuted.all(groupId).map(r => r.user_id);

// ── Bot Settings ──────────────────────────────────────────────────────────────
const BOT_SETTINGS_DEFAULTS = {
  prefix:             '.',
  botName:            'JuneX-Ultra',
  timezone:           'Africa/Nairobi',
  menuStyle:          '1',
  fontStyle:          'normal',
  presenceMode:       'off',
  autoReadMode:       'off',
  autoReact:          false,
  autoReactMode:      'bot',
  alwaysOnline:       false,
  autoStatusView:     false,
  autoStatusReact:    false,
  autoStatusEmoji:    '💙',
  autoStatusEmojiPool: [],
  autoStatusRandomEmoji: false,
  readReceipts:       'off',
  menuImageCustom:    false,
  selfMode:           false,
  autoSticker:        false,
  autoDownload:       false,
  autoBio:            false,
};

const getBotSetting = (key) => {
  const row = stmts.getSetting.get(key);
  if (!row) return BOT_SETTINGS_DEFAULTS[key];
  return parse(row.value, row.value);
};

const setBotSetting = (key, value) => {
  if (value === undefined || value === null) {
    db.prepare('DELETE FROM bot_settings WHERE key = ?').run(key);
  } else {
    stmts.setSetting.run(key, serial(value));
  }
  return true;
};

const getAllBotSettings = () => {
  const out = { ...BOT_SETTINGS_DEFAULTS };
  for (const { key, value } of stmts.getAllSettings.all()) {
    out[key] = parse(value, value);
  }
  return out;
};

const updateBotSettings = (updates) => {
  const txn = db.transaction((obj) => {
    for (const [k, v] of Object.entries(obj)) stmts.setSetting.run(k, serial(v));
  });
  txn(updates);
  return true;
};

// ── Bot Mode ──────────────────────────────────────────────────────────────────
const VALID_BOT_MODES = ['public', 'private', 'group', 'pm'];

const getBotMode = () => {
  const row = stmts.getSetting.get('__botMode');
  return row ? parse(row.value, 'public') : 'public';
};

const setBotMode = (mode) => {
  if (!VALID_BOT_MODES.includes(mode)) throw new Error(`Invalid mode: ${mode}`);
  stmts.setSetting.run('__botMode', serial(mode));
  return true;
};

// ── AntiForward Settings ──────────────────────────────────────────────────────
const getAntiforwardSettings = (groupId) => {
  const s = getGroupSettings(groupId);
  return {
    antiforward:            s.antiforward === true,
    antiforwardAction:      s.antiforwardAction      || 'delete',
    antiforwardWarnings:    s.antiforwardWarnings     || {},
    antiforwardMaxWarnings: s.antiforwardMaxWarnings  || 3,
  };
};

const updateAntiforwardSettings = (groupId, antiforwardEnabled, action = 'delete', maxWarnings = 3) => {
  updateGroupSettings(groupId, { antiforward: antiforwardEnabled, antiforwardAction: action, antiforwardMaxWarnings: maxWarnings });
  return true;
};

const addAntiforwardWarning = (groupId, userId) => {
  const s = getGroupSettings(groupId);
  if (!s.antiforwardWarnings) s.antiforwardWarnings = {};
  s.antiforwardWarnings[userId] = (s.antiforwardWarnings[userId] || 0) + 1;
  stmts.upsertGroup.run(groupId, serial(s));
  return s.antiforwardWarnings[userId];
};

const getAntiforwardWarningCount = (groupId, userId) => {
  const s = getGroupSettings(groupId);
  return (s.antiforwardWarnings && s.antiforwardWarnings[userId]) || 0;
};

const clearAntiforwardWarning = (groupId, userId) => {
  const s = getGroupSettings(groupId);
  if (!s.antiforwardWarnings) return false;
  delete s.antiforwardWarnings[userId];
  stmts.upsertGroup.run(groupId, serial(s));
  return true;
};

const clearAllAntiforwardWarnings = (groupId, userId) => {
  const s = getGroupSettings(groupId);
  if (!s.antiforwardWarnings) return false;
  s.antiforwardWarnings[userId] = 0;
  stmts.upsertGroup.run(groupId, serial(s));
  return true;
};

// ── Session ───────────────────────────────────────────────────────────────────
const saveSession = (credsPath) => {
  try {
    if (!fs.existsSync(credsPath)) return false;
    const creds = fs.readFileSync(credsPath).toString('base64');
    stmts.upsertSession.run(creds, Date.now());
    return true;
  } catch (e) {
    console.error('[SESSION-DB] saveSession error:', e.message);
    return false;
  }
};

const getSession = () => {
  try {
    const row = stmts.getSession.get();
    return row ? row.creds : null;
  } catch (e) {
    console.error('[SESSION-DB] getSession error:', e.message);
    return null;
  }
};

const clearSession = () => {
  stmts.clearSession.run();
  return true;
};

// ── Status Settings helpers ───────────────────────────────────────────────────
function loadSettings() {
  return {
    enabled:     getBotSetting('autoStatusView')        || false,
    react:       getBotSetting('autoStatusReact')       || false,
    emoji:       getBotSetting('autoStatusEmoji')       || '💙',
    emojiPool:   getBotSetting('autoStatusEmojiPool')   || [],
    randomEmoji: getBotSetting('autoStatusRandomEmoji') || false,
  };
}

function saveSettings(settings) {
  updateBotSettings({
    autoStatusView:        !!settings.enabled,
    autoStatusReact:       !!settings.react,
    autoStatusEmoji:       settings.emoji      || '',
    autoStatusEmojiPool:   settings.emojiPool  || [],
    autoStatusRandomEmoji: !!settings.randomEmoji,
  });
}

function cleanEmoji(str) {
  return str.replace(/[\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}\u200D\u200B\uFEFF]/gu, '').trim();
}

function pickEmoji(settings) {
  if (settings.randomEmoji && settings.emojiPool.length) {
    return settings.emojiPool[Math.floor(Math.random() * settings.emojiPool.length)];
  }
  return settings.emoji;
}

// ── KV Store (used by antibot, antidelete, antiedit, antideletestatus, etc.) ──
const getKV = (namespace, key, fallback = null) => {
  const row = stmts.getKV.get(namespace, key);
  if (!row) return fallback;
  return parse(row.value, fallback);
};

const setKV = (namespace, key, value) => {
  stmts.setKV.run(namespace, key, serial(value));
  return true;
};

const delKV = (namespace, key) => {
  stmts.delKV.run(namespace, key);
  return true;
};

const getAllKV = (namespace) => {
  const rows = stmts.allKV.all(namespace);
  const out = {};
  for (const { key, value } of rows) out[key] = parse(value);
  return out;
};

// ── Chatbot Memory ────────────────────────────────────────────────────────────
const CHAT_MEMORY_MAX  = 25;
const CHAT_MEMORY_FACTS = [
  [/my name is ([A-Za-z][\w-]*)/i,                    'name'],
  [/(?:i'm|i am) ([A-Za-z][\w-]*)(?:\s|$|,)/i,       'name'],
  [/call me ([A-Za-z][\w-]*)/i,                       'name'],
  [/(?:i'm|i am) (\d{1,3})(?: years? old)?/i,         'age'],
  [/i work (?:as |at )([\w\s-]{3,40})/i,              'job'],
  [/i(?:'m| am) from ([A-Za-z\s]{3,30})/i,            'location'],
  [/i live in ([A-Za-z\s]{3,30})/i,                   'location'],
  [/i (?:love|really like|like|enjoy) ([\w\s-]{3,40})/i, 'interest'],
  [/i (?:hate|dislike|can't stand) ([\w\s-]{3,40})/i,    'dislike'],
];
const CHAT_MEMORY_SKIP = new Set(['a', 'an', 'the', 'not', 'so', 'here', 'just', 'good', 'bad', 'fine', 'going', 'trying', 'using', 'happy', 'sad', 'tired', 'busy']);

const stmtGetProfile  = db.prepare('SELECT profile FROM chat_profiles WHERE bot_id = ? AND user_id = ?');
const stmtSaveProfile = db.prepare('INSERT INTO chat_profiles (bot_id, user_id, profile) VALUES (?, ?, ?) ON CONFLICT(bot_id, user_id) DO UPDATE SET profile = excluded.profile');

function loadProfile(botId, userId) {
  const bId = String(botId || 'default').replace(/[^\w-]/g, '_');
  const uId = String(userId).replace(/[^\w]/g, '_');
  const row  = stmtGetProfile.get(bId, uId);
  if (row) return parse(row.profile);
  const now = new Date().toISOString();
  return { userId, name: null, age: null, location: null, job: null, interests: [], dislikes: [], memories: [], messageCount: 0, firstSeen: now, lastSeen: now };
}

function saveProfile(botId, userId, profile) {
  const bId = String(botId || 'default').replace(/[^\w-]/g, '_');
  const uId = String(userId).replace(/[^\w]/g, '_');
  profile.lastSeen     = new Date().toISOString();
  profile.messageCount = (profile.messageCount || 0) + 1;
  stmtSaveProfile.run(bId, uId, serial(profile));
}

function learnFromMessage(text, profile) {
  const result = { ...profile, memories: [...(profile.memories || [])], interests: [...(profile.interests || [])], dislikes: [...(profile.dislikes || [])] };
  for (const [regex, tag] of CHAT_MEMORY_FACTS) {
    const match = String(text).match(regex);
    if (!match) continue;
    const raw = match[1].trim();
    if (!raw || raw.length > 60 || (tag === 'name' && CHAT_MEMORY_SKIP.has(raw.toLowerCase()))) continue;
    const value = raw.charAt(0).toUpperCase() + raw.slice(1);
    if (['name', 'age', 'location', 'job'].includes(tag) && !result[tag]) result[tag] = tag === 'age' ? `${value} years old` : value;
    if (tag === 'interest' && !result.interests.includes(value)) result.interests = [...result.interests, value].slice(-10);
    if (tag === 'dislike'  && !result.dislikes.includes(value))  result.dislikes  = [...result.dislikes, value].slice(-10);
    const memory = `User's ${tag}: ${value}`;
    if (!result.memories.some(item => item.toLowerCase() === memory.toLowerCase())) result.memories.unshift(memory);
  }
  result.memories = result.memories.slice(0, CHAT_MEMORY_MAX);
  return result;
}

function buildProfileContext(profile) {
  if (!profile) return '';
  const lines = [];
  for (const field of ['name', 'age', 'location', 'job']) if (profile[field]) lines.push(`- ${field}: ${profile[field]}`);
  if (profile.interests?.length) lines.push(`- interests: ${profile.interests.slice(0, 5).join(', ')}`);
  if (profile.dislikes?.length)  lines.push(`- dislikes: ${profile.dislikes.slice(0, 5).join(', ')}`);
  if (profile.messageCount > 1)  lines.push('- This is a returning user.');
  return lines.length ? `\nWhat you know about the user:\n${lines.join('\n')}\n` : '';
}

function getPersonalizedGreeting(profile) {
  return profile?.name ? `Hey ${profile.name}!` : null;
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────
process.on('exit', () => { try { db.close(); } catch (_) {} });

module.exports = {
  // Group
  getGroupSettings,
  updateGroupSettings,
  // User
  getUser,
  updateUser,
  // Warnings
  getWarnings,
  addWarning,
  removeWarning,
  clearWarnings,
  // Mods
  getModerators,
  addModerator,
  removeModerator,
  isModerator,
  // Bad words
  getBadWords,
  addBadWord,
  removeBadWord,
  // Muted
  muteUser,
  unmuteUser,
  isUserMuted,
  getMutedUsers,
  // Bot settings
  getBotSetting,
  setBotSetting,
  getAllBotSettings,
  updateBotSettings,
  BOT_SETTINGS_DEFAULTS,
  // Bot mode
  getBotMode,
  setBotMode,
  VALID_BOT_MODES,
  // Antiforward
  getAntiforwardSettings,
  updateAntiforwardSettings,
  addAntiforwardWarning,
  getAntiforwardWarningCount,
  clearAntiforwardWarning,
  clearAllAntiforwardWarnings,
  // Session
  saveSession,
  getSession,
  clearSession,
  // Status settings
  loadSettings,
  saveSettings,
  cleanEmoji,
  pickEmoji,
  // KV store
  getKV,
  setKV,
  delKV,
  getAllKV,
  // Chat profiles
  loadProfile,
  saveProfile,
  learnFromMessage,
  buildProfileContext,
  getPersonalizedGreeting,
  // Raw db (for groupstats etc.)
  _db: db,
};
