const database = require('../../database');

module.exports = {
    name: 'antisticker',
    aliases: ['antis'],
    category: 'admin',
    description: 'Block stickers in group — delete, warn the whole group, or kick sender',
    usage: '.antisticker <on/off/set/get>',
    groupOnly: true,
    adminOnly: true,
    botAdminNeeded: true,

    async execute(sock, msg, args, extra) {
        try {
            const settings = database.getGroupSettings(extra.from);
            const status   = settings.antisticker ? 'ON ✅' : 'OFF ❌';
            const action   = settings.antistickerAction || 'delete';

            const actionDesc = {
                delete: 'Delete sticker silently + notify group',
                warn:   'Delete + warn sender (group-wide) — removed at max warnings',
                kick:   'Delete + instantly remove sender from group',
            }[action] || action;

            if (!args[0]) {
                return extra.reply(
                    `🎭 *Anti Sticker*\n━━━━━━━━━━━━━━━\n\n` +
                    `📌 Status: *${status}*\n` +
                    `⚡ Action: *${action}* — _${actionDesc}_\n\n` +
                    `*Commands:*\n` +
                    `  .antisticker on\n` +
                    `  .antisticker off\n` +
                    `  .antisticker set delete  — silent delete + group notice\n` +
                    `  .antisticker set warn    — warn whole group, kick at max\n` +
                    `  .antisticker set kick    — instant remove from group\n` +
                    `  .antisticker get`
                );
            }

            const opt = args[0].toLowerCase();

            if (opt === 'on') {
                if (settings.antisticker) return extra.reply('🎭 *Anti Sticker is already ON*');
                database.updateGroupSettings(extra.from, { antisticker: true });
                return extra.reply(
                    `🎭 *Anti Sticker turned ON*\n` +
                    `⚡ Action: *${action}* — _${actionDesc}_\n\n` +
                    `_All sticker messages from non-admins will be handled automatically._`
                );
            }

            if (opt === 'off') {
                database.updateGroupSettings(extra.from, { antisticker: false });
                return extra.reply('🎭 *Anti Sticker turned OFF*');
            }

            if (opt === 'set') {
                if (!args[1]) return extra.reply('⚠️ Use: .antisticker set delete/warn/kick');
                const a = args[1].toLowerCase();
                if (!['delete', 'warn', 'kick'].includes(a))
                    return extra.reply('❌ Choose: *delete*, *warn*, or *kick*');
                database.updateGroupSettings(extra.from, { antistickerAction: a, antisticker: true });
                const desc = actionDesc;
                return extra.reply(
                    `🎭 *Anti Sticker action set to: ${a}*\n` +
                    `⚡ _${actionDesc}_\n\n` +
                    `_Anti Sticker is now ON._`
                );
            }

            if (opt === 'get') {
                return extra.reply(
                    `🎭 *Anti Sticker Config*\n━━━━━━━━━━━━━━━\n\n` +
                    `📌 Status: *${status}*\n` +
                    `⚡ Action: *${action}* — _${actionDesc}_`
                );
            }

            return extra.reply('⚠️ Use .antisticker for usage info.');
        } catch (error) {
            await extra.reply(`❌ Error: ${error.message}`);
        }
    }
};
