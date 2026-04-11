/**
 * Bot Mode Settings — read/write data/botmode.json
 * Modes: 'public' | 'private' | 'group' | 'pm'
 *
 *   public  — everyone can use commands in groups and DMs
 *   private — only owner/sudo can use commands anywhere
 *   group   — commands only work in groups (not in DMs)
 *   pm      — commands only work in DMs / private chats (not in groups)
 */
const fs   = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '../data/botmode.json');

const VALID_MODES = ['public', 'private', 'group', 'pm'];

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return { mode: 'public' };
  }
}

function save(data) {
  try { fs.writeFileSync(FILE, JSON.stringify(data, null, 2)); } catch {}
}

function getMode() {
  return load().mode || 'public';
}

function setMode(mode) {
  if (!VALID_MODES.includes(mode)) throw new Error(`Invalid mode: ${mode}`);
  save({ mode });
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

module.exports = { load, save, getMode, setMode, getModeLabel, VALID_MODES };
