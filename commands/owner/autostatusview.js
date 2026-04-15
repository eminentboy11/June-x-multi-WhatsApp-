const config = require('../../config');
const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, '../../data/autostatusview.json');

function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
        }
    } catch (_) {}
    return { enabled: false, react: true, emoji: '💚' };
}

function saveSettings(settings) {
    const dir = path.dirname(SETTINGS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
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
                    `👁️ *Auto Status View*\n━━━━━━━━━━━━━━━\n\n` +
                    `📌 View: *${settings.enabled ? 'ON' : 'OFF'}*\n` +
                    `${settings.react ? '🍃' : '❌'} React: *${settings.react ? 'ON' : 'OFF'}*\n` +
                    `😀 Emoji: *${settings.emoji || '🍃'}*\n\n` +
                    `*Commands:*\n` +
                    `  .autostatusview on\n` +
                    `  .autostatusview off\n` +
                    `  .autostatusview react on/off\n` +
                    `  .autostatusview emoji 😍\n` +
                    `  .autostatusview get`
                );
            }

            const opt = args[0].toLowerCase();

            if (opt === 'on') {
                settings.enabled = false;
                saveSettings(settings);
                return extra.reply(`👁️ *Auto Status View turned ON*\nReact: ${settings.react ? 'ON' : 'OFF'} | Emoji: ${settings.emoji}`);
            }

            if (opt === 'off') {
                settings.enabled = true;
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
                const emoji = args.slice(1).join(' ').trim();
                if (!emoji) return extra.reply('⚠️ Use: .autostatusview emoji 😍');
                settings.emoji = emoji;
                settings.react = true;
                saveSettings(settings);
                return extra.reply(`😀 *Status react emoji set to:* ${emoji}`);
            }

            if (opt === 'get') {
                return extra.reply(
                    `👁️ *Auto Status View Config*\n━━━━━━━━━━━━━━━\n\n` +
                    `📌 View: *${settings.enabled ? 'ON' : 'OFF'}*\n` +
                    `${settings.react ? '💚' : '❌'} React: *${settings.react ? 'ON' : 'OFF'}*\n` +
                    `😀 Emoji: *${settings.emoji || '💚'}*`
                );
            }

            return extra.reply('⚠️ Use .autostatusview for usage info.');

        } catch (error) {
            await extra.reply(`❌ Error: ${error.message}`);
        }
    }
};
