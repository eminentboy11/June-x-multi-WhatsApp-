const database = require('../../database');
const loadSettings = () => database.loadSettings();
const saveSettings = (s) => database.saveSettings(s);

module.exports = {
    name: 'autostatusreact',
    aliases: ['statusreact', 'asr'],
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
                const emojiInfo = settings.randomEmoji && settings.emojiPool.length
                    ? `🎲 Random pool: ${settings.emojiPool.join('  ')}`
                    : `Emoji: ${settings.emoji}`;
                return extra.reply(`💙 *Status React turned ON*\n${emojiInfo}`);
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
