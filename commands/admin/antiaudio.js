const database = require(require('path').join(global.__CORE__, 'database'));

module.exports = {
    name: 'antiaudio',
    aliases: ['antivoice', 'antivn'],
    category: 'admin',
    description: 'Block audio/voice notes in group (delete/warn/kick)',
    usage: '.antiaudio <on/off/set/get>',
    groupOnly: true,
    adminOnly: true,
    botAdminNeeded: true,

    async execute(sock, msg, args, extra) {
        try {
            const settings = database.getGroupSettings(extra.from);
            const current = settings.antiaudio ? 'ON' : 'OFF';
            const action = settings.antiaudioAction || 'delete';

            if (!args[0]) {
                return extra.reply(
                    `🔇 *Anti Audio*\n━━━━━━━━━━━━━━━\n\n` +
                    `📌 Status: *${current}*\n` +
                    `⚡ Action: *${action}*\n\n` +
                    `*Usage:*\n` +
                    `  .antiaudio on\n` +
                    `  .antiaudio off\n` +
                    `  .antiaudio set delete\n` +
                    `  .antiaudio set warn\n` +
                    `  .antiaudio set kick\n` +
                    `  .antiaudio get`
                );
            }

            const opt = args[0].toLowerCase();

            if (opt === 'on') {
                if (settings.antiaudio) return extra.reply('🔇 *Anti Audio is already ON*');
                database.updateGroupSettings(extra.from, { antiaudio: true });
                return extra.reply(`🔇 *Anti Audio turned ON*\n⚡ Action: *${action}*`);
            }
            if (opt === 'off') {
                database.updateGroupSettings(extra.from, { antiaudio: false });
                return extra.reply('🔇 *Anti Audio turned OFF*');
            }
            if (opt === 'set') {
                if (!args[1]) return extra.reply('⚠️ Use: .antiaudio set delete/warn/kick');
                const a = args[1].toLowerCase();
                if (!['delete', 'warn', 'kick'].includes(a)) return extra.reply('❌ Choose: delete, warn, or kick');
                database.updateGroupSettings(extra.from, { antiaudioAction: a, antiaudio: true });
                return extra.reply(`🔇 *Anti Audio action set to ${a}*`);
            }
            if (opt === 'get') {
                return extra.reply(`🔇 *Anti Audio Config*\n📌 Status: *${current}*\n⚡ Action: *${action}*`);
            }
            return extra.reply('⚠️ Use .antiaudio for usage info.');
        } catch (error) {
            await extra.reply(`❌ Error: ${error.message}`);
        }
    }
};
