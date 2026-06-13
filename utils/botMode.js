/**
 * Bot Mode Settings — backed by database/botmode.json
 * Modes: 'public' | 'private' | 'group' | 'pm'
 *
 *   public  — everyone can use commands in groups and DMs
 *   private — only owner/sudo can use commands anywhere
 *   group   — commands only work in groups (not in DMs)
 *   pm      — commands only work in DMs / private chats (not in groups)
 */
const db = require('../database');

const VALID_MODES = db.VALID_BOT_MODES;

function getMode() {
  return db.getBotMode();
}

function setMode(mode) {
  db.setBotMode(mode);
}

function getModeLabel() {
  const labels = {
    public:  '🌐 Public',
    private: '🔒 Private',
    group:   '👥 Group Only',
    pm:      '💬 PM Only'
  };
  return labels[getMode()] || '🌐 Public';
}

module.exports = { getMode, setMode, getModeLabel, VALID_MODES };
