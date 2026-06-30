/**
 * Shared presence settings — backed by database/bot-settings.json via database.js
 * Modes: 'off' | 'typing' | 'recording' | 'recordtype'
 */
const db = require('../database');

const KEY = 'presenceMode';

function load() {
  return { mode: db.getBotSetting(KEY) || 'off' };
}

function save(data) {
  db.setBotSetting(KEY, data.mode || 'off');
}

function getMode() {
  return db.getBotSetting(KEY) || 'off';
}

function setMode(mode) {
  db.setBotSetting(KEY, mode);
}

module.exports = { load, save, getMode, setMode };
