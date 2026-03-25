const config = require('../../config');

module.exports = {
    name: 'ping',
    aliases: ['p'],
    category: 'general',
    description: 'Check bot response time',
    usage: '.ping',

    async execute(sock, msg, args, extra) {
        try {
            const start = performance.now();
            const botName = config.botName || 'June Ultra';
            const end = performance.now();
            const responseTime = (end - start).toFixed(3);

            await sock.sendMessage(extra.from, {
                text: `🏓 *${botName} Speed ${responseTime}ms*`
            }, { quoted: msg });

        } catch (error) {
            await extra.reply(`❌ Error: ${error.message}`);
        }
    }
};
