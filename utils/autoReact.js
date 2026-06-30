/**
 * Auto-React settings — backed by database/bot-settings.json via database.js.
 * No longer modifies config.js directly.
 */
const db = require('../database');

function load() {
  return {
    enabled: db.getBotSetting('autoReact') || false,
    mode:    db.getBotSetting('autoReactMode') || 'bot',
  };
}

function save(data) {
  db.updateBotSettings({
    autoReact:     !!data.enabled,
    autoReactMode: data.mode || 'bot',
  });

  // Keep runtime config in sync so handler.js sees the change immediately
  try {
    const config = require('../config');
    config.autoReact     = !!data.enabled;
    config.autoReactMode = data.mode || 'bot';
  } catch (_) {}
}

module.exports = { load, save };
