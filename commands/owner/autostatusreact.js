const { loadSettings, saveSettings } = require('../../utils/statusSettings');

module.exports = {
    name: 'autostatusreact',
    aliases: ['statusreact'],
    category: 'owner',
    description: 'Auto-react to WhatsApp statuses',
    usage: '.autostatusreact <on/off/get>',
    ownerOnly: true,

    async execute(sock, msg, args, extra) {
        try {
            const settings = loadSettings();
            const opt = (args[0] || '').toLowerCase();

            if (opt === 'on') {
                settings.react = true;
                saveSettings(settings);
                return extra.reply(`💙 *Status React turned ON*\nEmoji: ${settings.emoji}`);
            }

            if (opt === 'off') {
                settings.react = false;
                saveSettings(settings);
                return extra.reply('❌ *Status React turned OFF*');
            }

            if (opt === 'get') {
                return extra.reply(`${settings.react ? '💙' : '❌'} React: *${settings.react ? 'ON' : 'OFF'}*`);
            }

            return extra.reply('⚠️ Use .autostatusreact <on/off/get>');
        } catch (error) {
            await extra.reply(`❌ Error: ${error.message}`);
        }
    }
};