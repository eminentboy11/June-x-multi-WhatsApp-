/**
 * Runtime Settings — persists prefix, botName, timezone, menuStyle, fontStyle
 * and other owner-changed config values across bot restarts.
 *
 * Storage: All values are written to database/bot-settings.json via database.js,
 * which survives every restart and session-clear scenario.
 *
 * Usage:
 *   const settings = require('./utils/settings');
 *   settings.get('prefix')          // read a value
 *   settings.set('prefix', '!')     // write and persist
 *   settings.applyToConfig(config)  // call once at startup
 */

const db = require('../database');

// Keys that this module manages (subset of BOT_SETTINGS_DEFAULTS)
const MANAGED_KEYS = ['prefix', 'botName', 'timezone', 'menuStyle', 'fontStyle'];

const DEFAULTS = {
  prefix:    '.',
  botName:   'JuneX-Ultra',
  timezone:  'Africa/Nairobi',
  menuStyle: '1',
  fontStyle: 'normal',
};

function get(key) {
  return db.getBotSetting(key);
}

function set(key, value) {
  db.setBotSetting(key, value);
}

function load() {
  const all = db.getAllBotSettings();
  // Return only the keys relevant to this module
  const out = {};
  for (const key of MANAGED_KEYS) {
    if (key in all) out[key] = all[key];
  }
  return out;
}

function save(data) {
  db.updateBotSettings(data);
}

function applyToConfig(config) {
  const all = db.getAllBotSettings();
  for (const [key, value] of Object.entries(all)) {
    if (key in config) {
      config[key] = value;
    }
  }
}

module.exports = { get, set, load, save, applyToConfig, DEFAULTS };
