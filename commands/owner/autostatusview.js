const { loadSettings, saveSettings } = require('../../utils/statusSettings');

module.exports = {
    name: 'autostatusview',
    aliases: ['autostatus', 'autoview', 'statusview'],
    category: 'owner',
    description: 'Auto-view WhatsApp statuses',
    usage: '.autostatusview <on/off/get>',
    ownerOnly: true,

    async execute(sock, msg, args, extra) {
        try {
            const settings = loadSettings();
            const opt = (args[0] || '').toLowerCase();

            if (!opt) {
                return extra.reply(
                    `👁️ *AUTO STATUS VIEW*\n━━━━━━━━━━━━\n` +
                    `STATUS: ${settings.enabled ? '🟢 ON' : '🔴 OFF'}\n━━━━━━━━━━━━\n` +
                    ` ✧ autostatusview on\n ✧ autostatusview off\n ✧ autostatusview get`
                );
            }

            if (opt === 'on') {
                settings.enabled = true;
                saveSettings(settings);
                return extra.reply('👁️ *Auto Status View turned ON*');
            }

            if (opt === 'off') {
                settings.enabled = false;
                saveSettings(settings);
                return extra.reply('👁️ *Auto Status View turned OFF*');
            }

            if (opt === 'get') {
                return extra.reply(`📌 View: *${settings.enabled ? 'ON' : 'OFF'}*`);
            }

            return extra.reply('⚠️ Use .autostatusview <on/off/get>');
        } catch (error) {
            await extra.reply(`❌ Error: ${error.message}`);
        }
    }
};