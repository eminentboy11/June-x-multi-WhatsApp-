/**
 * Auto Status View — persists via database/bot-settings.json via database.js
 */
const db = require('../../database');

function loadSettings() {
    return {
        enabled: db.getBotSetting('autoStatusView')  || false,
        react:   db.getBotSetting('autoStatusReact') || false,
        emoji:   db.getBotSetting('autoStatusEmoji') || '💚',
    };
}

function saveSettings(settings) {
    db.updateBotSettings({
        autoStatusView:  !!settings.enabled,
        autoStatusReact: !!settings.react,
        autoStatusEmoji: settings.emoji || '💚',
    });
}

// Strip invisible variation selectors / zero-width chars that WhatsApp
// sometimes appends to emoji — prevents the "double emoji" display bug
function cleanEmoji(str) {
    return str.replace(/[\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}\u200D\u200B\uFEFF]/gu, '').trim();
}

module.exports = {
    name: 'autostatusview',
    aliases: ['autostatus', 'autoview', 'statusview'],
    category: 'owner',
    description: 'Auto-view and react to WhatsApp statuses',
    usage: '.autostatusview <on/off/react/emoji/get>',
    ownerOnly: true,

    loadSettings,
    saveSettings,

    async execute(sock, msg, args, extra) {
        try {
            const settings = loadSettings();

            if (!args[0]) {
                return extra.reply(
                    ` *AUTO STATUS VIEW*\n━━━━━━━━━━━━━━━\n\n` +
                    ` View: *${settings.enabled ? 'ON' : 'OFF'}*\n` +
                    `${settings.react ? '💚' : '❌'} React: *${settings.react ? 'ON' : 'OFF'}*\n` +
                    `React Emoji: *${settings.emoji || '💚'}*\n\n` +
                    `*Commands:*\n` +
                    `  autostatusview <on/off>\n` +
                    `  autostatusview react <on/off>\n` +
                    `  autostatusview emoji <😍>`
                );
            }

            const opt = args[0].toLowerCase();

            if (opt === 'on') {
                settings.enabled = true;
                saveSettings(settings);
                return extra.reply(`👁️ *Auto Status View turned ON*\nReact: ${settings.react ? 'ON' : 'OFF'} | Emoji: ${settings.emoji}`);
            }

            if (opt === 'off') {
                settings.enabled = false;
                saveSettings(settings);
                return extra.reply('👁️ *Auto Status View turned OFF*');
            }

            if (opt === 'react') {
                if (!args[1]) return extra.reply('⚠️ Use: .autostatusview react on/off');
                const val = args[1].toLowerCase();
                if (val === 'on') {
                    settings.react = true;
                    saveSettings(settings);
                    return extra.reply(`💚 *Status React turned ON*\nEmoji: ${settings.emoji}`);
                } else if (val === 'off') {
                    settings.react = false;
                    saveSettings(settings);
                    return extra.reply('❌ *Status React turned OFF*');
                }
                return extra.reply('⚠️ Use: .autostatusview react on/off');
            }

            if (opt === 'emoji' || opt === 'setemoji') {
                const raw = args.slice(1).join('').trim();
                const emoji = cleanEmoji(raw);
                if (!emoji) return extra.reply('⚠️ Use: .autostatusview emoji <😍>');
                settings.emoji = emoji;
                saveSettings(settings);
                return extra.reply(`✅ *React emoji set to:* ${emoji}`);
            }

            if (opt === 'get') {
                return extra.reply(
                    `👁️ *Auto Status View Config*\n━━━━━━━━━━━━━━━\n\n` +
                    `📌 View: *${settings.enabled ? 'ON' : 'OFF'}*\n` +
                    `${settings.react ? '💚' : '❌'} React: *${settings.react ? 'ON' : 'OFF'}*\n` +
                    `React Emoji: *${settings.emoji || '💚'}*`
                );
            }

            return extra.reply('⚠️ Use .autostatusview for usage info.');

        } catch (error) {
            await extra.reply(`❌ Error: ${error.message}`);
        }
    }
};
