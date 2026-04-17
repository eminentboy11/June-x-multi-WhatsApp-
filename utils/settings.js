/**
 * Runtime Settings — persists prefix, botName, timezone, menuStyle and other
 * owner-changed config values across bot restarts.
 *
 * Storage: Written to the SESSION directory (e.g. session/bot-settings.json).
 * Panels always keep the session directory alive (otherwise the bot would need
 * to re-pair), so this file survives every restart scenario.
 *
 * Usage:
 *   const settings = require('./utils/settings');
 *   settings.get('prefix')          // read a value
 *   settings.set('prefix', '!')     // write and persist
 *   settings.applyToConfig(config)  // call once at startup
 */

const fs   = require('fs');
const path = require('path');

const DEFAULTS = {
  prefix:    '.',
  botName:   'June-Ultra',
  timezone:  'Africa/Nairobi',
  menuStyle: '1',
  fontStyle: 'normal'
};

// Resolve the session directory from config (same logic as index.js)
function getSettingsFile() {
  try {
    const cfg = require('../config');
    const sessionName = cfg.sessionName || 'session';
    const sessionDir  = path.join(__dirname, '..', sessionName);
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }
    return path.join(sessionDir, 'bot-settings.json');
  } catch (_) {
    // Fallback: data/ directory
    const fallback = path.join(__dirname, '../data/settings.json');
    const dir = path.dirname(fallback);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return fallback;
  }
}

function load() {
  try {
    const file = getSettingsFile();
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    // Also try the old data/settings.json location and migrate
    const legacy = path.join(__dirname, '../data/settings.json');
    if (fs.existsSync(legacy)) {
      const data = JSON.parse(fs.readFileSync(legacy, 'utf8'));
      save(data); // migrate to session dir
      return data;
    }
  } catch (_) {}
  return {};
}

function save(data) {
  try {
    const file = getSettingsFile();
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('[Settings] write error:', e.message);
  }
}

function get(key) {
  const data = load();
  return key in data ? data[key] : DEFAULTS[key];
}

function set(key, value) {
  const data = load();
  data[key] = value;
  save(data);
}

function applyToConfig(config) {
  const data = load();
  for (const [key, value] of Object.entries(data)) {
    if (key in config) {
      config[key] = value;
    }
  }
}

module.exports = { get, set, load, save, applyToConfig, DEFAULTS };
