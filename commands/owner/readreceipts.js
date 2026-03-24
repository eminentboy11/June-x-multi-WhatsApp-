const config = require('../../config');

module.exports = {
    name: 'readreceipts',
    aliases: ['rr', 'bluemark', 'bluetick', 'readreceipt'],
    category: 'owner',
    description: 'Toggle read receipts (blue ticks) on or off',
    usage: '.readreceipts <on/off>',
    ownerOnly: true,

    async execute(sock, msg, args, extra) {
        try {
            if (!args[0]) {
                return extra.reply(
                    `👁️ *Read Receipts*\n━━━━━━━━━━━━━━━\n\n` +
                    `Toggle blue ticks visibility.\n\n` +
                    `*Usage:*\n` +
                    `  .readreceipts on — Others see your blue ticks\n` +
                    `  .readreceipts off — Hide blue ticks from others`
                );
            }

            const opt = args[0].toLowerCase();

            if (opt === 'on') {
                await sock.updateReadReceiptsPrivacy('all');
                return extra.reply('✅ *Read Receipts turned ON*\n\nOthers will see blue ticks when you read messages.');
            }

            if (opt === 'off') {
                await sock.updateReadReceiptsPrivacy('none');
                return extra.reply('✅ *Read Receipts turned OFF*\n\nBlue ticks are now hidden from others.');
            }

            return extra.reply('⚠️ Use: .readreceipts on/off');

        } catch (error) {
            console.error('readreceipts error:', error);
            await extra.reply(`❌ Error: ${error.message}`);
        }
    }
};
