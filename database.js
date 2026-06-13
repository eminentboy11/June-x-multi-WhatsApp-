/**
 * Simple JSON-based Database for Group Settings
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');

const DB_PATH = path.join(__dirname, 'database');
const GROUPS_DB = path.join(DB_PATH, 'groups.json');
const USERS_DB = path.join(DB_PATH, 'users.json');
const WARNINGS_DB = path.join(DB_PATH, 'warnings.json');
const MODS_DB = path.join(DB_PATH, 'mods.json');
const MUTED_DB = path.join(DB_PATH, 'muted.json');
const BOTMODE_DB = path.join(DB_PATH, 'botmode.json');

// Initialize database directory
if (!fs.existsSync(DB_PATH)) {
  fs.mkdirSync(DB_PATH, { recursive: true });
}

// Initialize database files
const initDB = (filePath, defaultData = {}) => {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2));
  }
};

initDB(GROUPS_DB, {});
initDB(USERS_DB, {});
initDB(WARNINGS_DB, {});
initDB(MODS_DB, { moderators: [] });
initDB(MUTED_DB, {});
initDB(BOTMODE_DB, { mode: 'public' });

// Read database
const readDB = (filePath) => {
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error reading database: ${error.message}`);
    return {};
  }
};

// Write database
const writeDB = (filePath, data) => {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error(`Error writing database: ${error.message}`);
    return false;
  }
};

// Group Settings
const getGroupSettings = (groupId) => {
  const groups = readDB(GROUPS_DB);
  if (!groups[groupId]) {
    groups[groupId] = { ...config.defaultGroupSettings };
    writeDB(GROUPS_DB, groups);
  }
  return groups[groupId];
};

const updateGroupSettings = (groupId, settings) => {
  const groups = readDB(GROUPS_DB);
  groups[groupId] = { ...groups[groupId], ...settings };
  return writeDB(GROUPS_DB, groups);
};

// User Data
const getUser = (userId) => {
  const users = readDB(USERS_DB);
  if (!users[userId]) {
    users[userId] = {
      registered: Date.now(),
      premium: false,
      banned: false
    };
    writeDB(USERS_DB, users);
  }
  return users[userId];
};

const updateUser = (userId, data) => {
  const users = readDB(USERS_DB);
  users[userId] = { ...users[userId], ...data };
  return writeDB(USERS_DB, users);
};

// Warnings System
const getWarnings = (groupId, userId) => {
  const warnings = readDB(WARNINGS_DB);
  const key = `${groupId}_${userId}`;
  return warnings[key] || { count: 0, warnings: [] };
};

const addWarning = (groupId, userId, reason) => {
  const warnings = readDB(WARNINGS_DB);
  const key = `${groupId}_${userId}`;
  
  if (!warnings[key]) {
    warnings[key] = { count: 0, warnings: [] };
  }
  
  warnings[key].count++;
  warnings[key].warnings.push({
    reason,
    date: Date.now()
  });
  
  writeDB(WARNINGS_DB, warnings);
  return warnings[key];
};

const removeWarning = (groupId, userId) => {
  const warnings = readDB(WARNINGS_DB);
  const key = `${groupId}_${userId}`;
  
  if (warnings[key] && warnings[key].count > 0) {
    warnings[key].count--;
    warnings[key].warnings.pop();
    writeDB(WARNINGS_DB, warnings);
    return true;
  }
  return false;
};

const clearWarnings = (groupId, userId) => {
  const warnings = readDB(WARNINGS_DB);
  const key = `${groupId}_${userId}`;
  delete warnings[key];
  return writeDB(WARNINGS_DB, warnings);
};

// Moderators System
const getModerators = () => {
  const mods = readDB(MODS_DB);
  return mods.moderators || [];
};

const addModerator = (userId) => {
  const mods = readDB(MODS_DB);
  if (!mods.moderators) mods.moderators = [];
  if (!mods.moderators.includes(userId)) {
    mods.moderators.push(userId);
    return writeDB(MODS_DB, mods);
  }
  return false;
};

const removeModerator = (userId) => {
  const mods = readDB(MODS_DB);
  if (mods.moderators) {
    mods.moderators = mods.moderators.filter(id => id !== userId);
    return writeDB(MODS_DB, mods);
  }
  return false;
};

const isModerator = (userId) => {
  const mods = getModerators();
  if (mods.includes(userId)) return true;
  const config = require('./config');
  const sessionPath = require('path').join(__dirname, config.sessionName || 'session');
  const revFile = require('path').join(sessionPath, `lid-mapping-${userId}_reverse.json`);
  try {
    if (require('fs').existsSync(revFile)) {
      const pn = JSON.parse(require('fs').readFileSync(revFile, 'utf8').trim());
      if (pn && mods.includes(String(pn))) return true;
    }
  } catch (_) {}
  return false;
};

// Bad Words per group
const getBadWords = (groupId) => {
  const groups = readDB(GROUPS_DB);
  const settings = groups[groupId] || {};
  return Array.isArray(settings.badwords) ? settings.badwords : [];
};

const addBadWord = (groupId, word) => {
  const groups = readDB(GROUPS_DB);
  if (!groups[groupId]) groups[groupId] = { ...config.defaultGroupSettings };
  if (!Array.isArray(groups[groupId].badwords)) groups[groupId].badwords = [];
  const normalized = word.toLowerCase().trim();
  if (!groups[groupId].badwords.includes(normalized)) {
    groups[groupId].badwords.push(normalized);
    writeDB(GROUPS_DB, groups);
    return true;
  }
  return false;
};

const removeBadWord = (groupId, word) => {
  const groups = readDB(GROUPS_DB);
  if (!groups[groupId] || !Array.isArray(groups[groupId].badwords)) return false;
  const normalized = word.toLowerCase().trim();
  const before = groups[groupId].badwords.length;
  groups[groupId].badwords = groups[groupId].badwords.filter(w => w !== normalized);
  if (groups[groupId].badwords.length < before) {
    writeDB(GROUPS_DB, groups);
    return true;
  }
  return false;
};

// ── Muted Users Per Group ─────────────────────────────────────────────────────
const muteUser = (groupId, userId) => {
  const data = readDB(MUTED_DB);
  if (!data[groupId]) data[groupId] = [];
  const norm = userId.split('@')[0] + '@s.whatsapp.net';
  if (!data[groupId].includes(norm)) {
    data[groupId].push(norm);
    writeDB(MUTED_DB, data);
  }
  return true;
};

const unmuteUser = (groupId, userId) => {
  const data = readDB(MUTED_DB);
  if (!data[groupId]) return false;
  const norm = userId.split('@')[0] + '@s.whatsapp.net';
  const before = data[groupId].length;
  data[groupId] = data[groupId].filter(u => u !== norm);
  if (data[groupId].length < before) {
    writeDB(MUTED_DB, data);
    return true;
  }
  return false;
};

const isUserMuted = (groupId, userId) => {
  const data = readDB(MUTED_DB);
  if (!data[groupId]) return false;
  const norm = userId.split('@')[0] + '@s.whatsapp.net';
  return data[groupId].includes(norm);
};

const getMutedUsers = (groupId) => {
  const data = readDB(MUTED_DB);
  return data[groupId] || [];
};

// Bot Mode
const VALID_BOT_MODES = ['public', 'private', 'group', 'pm'];

const getBotMode = () => {
  const data = readDB(BOTMODE_DB);
  return data.mode || 'public';
};

const setBotMode = (mode) => {
  if (!VALID_BOT_MODES.includes(mode)) throw new Error(`Invalid mode: ${mode}`);
  return writeDB(BOTMODE_DB, { mode });
};

module.exports = {
  getGroupSettings,
  updateGroupSettings,
  getUser,
  updateUser,
  getWarnings,
  addWarning,
  removeWarning,
  clearWarnings,
  getModerators,
  addModerator,
  removeModerator,
  isModerator,
  getBadWords,
  addBadWord,
  removeBadWord,
  muteUser,
  unmuteUser,
  isUserMuted,
  getMutedUsers,
  getBotMode,
  setBotMode,
  VALID_BOT_MODES,
};
