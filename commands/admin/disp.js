module.exports = {
    name: 'disp',
    aliases: ['disappear', 'disappearing', 'ephemeral', 'vanish'],
    category: 'admin',
    description: 'Set disappearing messages timer in chat/group',
    usage: '.disp <off/24h/7d/90d>',
    groupOnly: true,
    adminOnly: true,
    botAdminNeeded: true,

    async execute(sock, msg, args, extra) {
        try {
            const durations = {
                'off': 0,
                '0': 0,
                '24h': 86400,
                '1d': 86400,
                '7d': 604800,
                '1w': 604800,
                '90d': 7776000,
                '3m': 7776000,
            };

            if (!args[0]) {
                return extra.reply(
                    `⏳ *Disappearing Messages*\n━━━━━━━━━━━━━━━\n\n` +
                    `Set auto-delete timer for messages.\n\n` +
                    `*Usage:*\n` +
                    `  .disp off — Disable\n` +
                    `  .disp 24h — 24 hours\n` +
                    `  .disp 7d — 7 days\n` +
                    `  .disp 90d — 90 days`
                );
            }

            const opt = args[0].toLowerCase();
            const duration = durations[opt];

            if (duration === undefined) {
                return extra.reply('❌ *Invalid option.*\n\nChoose: off, 24h, 7d, or 90d');
            }

            await sock.sendMessage(extra.from, { disappearingMessagesInChat: duration });

            if (duration === 0) {
                return extra.reply('✅ *Disappearing messages turned OFF*\n\nMessages will no longer auto-delete.');
            }

            const labels = { 86400: '24 hours', 604800: '7 days', 7776000: '90 days' };
            return extra.reply(`✅ *Disappearing messages set to ${labels[duration]}*\n\nMessages will auto-delete after ${labels[duration]}.`);

        } catch (error) {
            console.error('disp error:', error);
            await extra.reply(`❌ Error: ${error.message}`);
        }
    }
};
