const database = require(require('path').join(global.__CORE__, 'database'));

module.exports = {
    name: 'antiimage',
    aliases: ['antiphoto', 'antiimg'],
    category: 'admin',
    description: 'Block images in group (delete/warn/kick)',
    usage: '.antiimage <on/off/set/get>',
    groupOnly: true,
    adminOnly: true,
    botAdminNeeded: true,

    async execute(sock, msg, args, extra) {
        try {
            const settings = database.getGroupSettings(extra.from);
            const current = settings.antiimage ? 'ON' : 'OFF';
            const action = settings.antiimageAction || 'delete';

            if (!args[0]) {
                return extra.reply(
                    `🖼️ *Anti Image*\n━━━━━━━━━━━━━━━\n\n` +
                    `📌 Status: *${current}*\n` +
                    `⚡ Action: *${action}*\n\n` +
                    `*Usage:*\n` +
                    `  .antiimage on\n` +
                    `  .antiimage off\n` +
                    `  .antiimage set delete\n` +
                    `  .antiimage set warn\n` +
                    `  .antiimage set kick\n` +
                    `  .antiimage get`
                );
            }

            const opt = args[0].toLowerCase();

            if (opt === 'on') {
                if (settings.antiimage) return extra.reply('🖼️ *Anti Image is already ON*');
                database.updateGroupSettings(extra.from, { antiimage: true });
                return extra.reply(`🖼️ *Anti Image turned ON*\n⚡ Action: *${action}*`);
            }
            if (opt === 'off') {
                database.updateGroupSettings(extra.from, { antiimage: false });
                return extra.reply('🖼️ *Anti Image turned OFF*');
            }
            if (opt === 'set') {
                if (!args[1]) return extra.reply('⚠️ Use: .antiimage set delete/warn/kick');
                const a = args[1].toLowerCase();
                if (!['delete', 'warn', 'kick'].includes(a)) return extra.reply('❌ Choose: delete, warn, or kick');
                database.updateGroupSettings(extra.from, { antiimageAction: a, antiimage: true });
                return extra.reply(`🖼️ *Anti Image action set to ${a}*`);
            }
            if (opt === 'get') {
                return extra.reply(`🖼️ *Anti Image Config*\n📌 Status: *${current}*\n⚡ Action: *${action}*`);
            }
            return extra.reply('⚠️ Use .antiimage for usage info.');
        } catch (error) {
            await extra.reply(`❌ Error: ${error.message}`);
        }
    }
};
