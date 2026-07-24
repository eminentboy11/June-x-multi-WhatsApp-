const db = require('../database');

function loadSettings() {
    return {
        enabled: db.getBotSetting('autoStatusView')  || false,
        react:   db.getBotSetting('autoStatusReact') || false,
        emoji:   db.getBotSetting('autoStatusEmoji') || '💚',
        emojiPool: db.getBotSetting('autoStatusEmojiPool') || [], // for random mode
        randomEmoji: db.getBotSetting('autoStatusRandomEmoji') || false,
    };
}

function saveSettings(settings) {
    db.updateBotSettings({
        autoStatusView:       !!settings.enabled,
        autoStatusReact:      !!settings.react,
        autoStatusEmoji:      settings.emoji || '',
        autoStatusEmojiPool:  settings.emojiPool || [],
        autoStatusRandomEmoji:!!settings.randomEmoji,
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

module.exports = { loadSettings, saveSettings, cleanEmoji, pickEmoji };