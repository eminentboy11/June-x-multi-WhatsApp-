const database = require('../../database');

module.exports = {
    name: 'antisticker',
    aliases: ['antis'],
    category: 'admin',
    description: 'Block stickers in group (delete/warn/kick)',
    usage: '.antisticker <on/off/set/get>',
    groupOnly: true,
    adminOnly: true,
    botAdminNeeded: true,

    async execute(sock, msg, args, extra) {
        try {
            const settings = database.getGroupSettings(extra.from);
            const current = settings.antisticker ? 'ON' : 'OFF';
            const action = settings.antistickerAction || 'delete';

            if (!args[0]) {
                return extra.reply(
                    `🎭 *Anti Sticker*\n━━━━━━━━━━━━━━━\n\n` +
                    `📌 Status: *${current}*\n` +
                    `⚡ Action: *${action}*\n\n` +
                    `*Usage:*\n` +
                    `  .antisticker on\n` +
                    `  .antisticker off\n` +
                    `  .antisticker set delete\n` +
                    `  .antisticker set warn\n` +
                    `  .antisticker set kick\n` +
                    `  .antisticker get`
                );
            }

            const opt = args[0].toLowerCase();

            if (opt === 'on') {
                if (settings.antisticker) return extra.reply('🎭 *Anti Sticker is already ON*');
                database.updateGroupSettings(extra.from, { antisticker: true });
                return extra.reply(`🎭 *Anti Sticker turned ON*\n⚡ Action: *${action}*`);
            }
            if (opt === 'off') {
                database.updateGroupSettings(extra.from, { antisticker: false });
                return extra.reply('🎭 *Anti Sticker turned OFF*');
            }
            if (opt === 'set') {
                if (!args[1]) return extra.reply('⚠️ Use: .antisticker set delete/warn/kick');
                const a = args[1].toLowerCase();
                if (!['delete', 'warn', 'kick'].includes(a)) return extra.reply('❌ Choose: delete, warn, or kick');
                database.updateGroupSettings(extra.from, { antistickerAction: a, antisticker: true });
                return extra.reply(`🎭 *Anti Sticker action set to ${a}*`);
            }
            if (opt === 'get') {
                return extra.reply(`🎭 *Anti Sticker Config*\n📌 Status: *${current}*\n⚡ Action: *${action}*`);
            }
            return extra.reply('⚠️ Use .antisticker for usage info.');
        } catch (error) {
            await extra.reply(`❌ Error: ${error.message}`);
        }
    }
};
