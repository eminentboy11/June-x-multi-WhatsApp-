/**
 * Bot Mode Settings — backed by SQLite via database.js (bot_settings table, key='__botMode')
 */

'use strict';

const db = require('../database');

const VALID_MODES = db.VALID_BOT_MODES || ['public', 'private', 'group', 'pm'];

const MODE_LABELS = {
  public:  '🌐 Public',
  private: '🔒 Private',
  group:   '👥 Groups Only',
  pm:      '💬 PM Only',
};

function getBotMode() {
  return db.getBotMode();
}

function setBotMode(mode) {
  return db.setBotMode(mode);
}

function getModeLabel() {
  return MODE_LABELS[getBotMode()] || '🌐 Public';
}

// Aliases used by handler.js, commands/owner/mode.js, and other callers
const getMode = getBotMode;
const setMode = setBotMode;

module.exports = { getBotMode, setBotMode, getMode, setMode, getModeLabel, VALID_MODES };
