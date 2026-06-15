/* by supreme */
const config = require('../../config');
const { applyFont } = require('../../utils/fontConverter');

module.exports = {
    name: 'ping',
    aliases: ['pong', 'p'],
    category: 'general',
    description: 'Check bot response speed with high precision (edits message)',
    usage: '.ping',

    async execute(sock, msg, args, extra) {
        try {
            const chatId = extra.from;
            const botName = config.botName || 'June-Ultra';
            const isDM = !chatId.endsWith('@g.us');

            const start = performance.now();
            const sentMsg = await sock.sendMessage(chatId, {
                text: applyFont('🔸 pong!...')
            }, isDM ? { quoted: msg } : {});

            const ping = (performance.now() - start).toFixed(3);
            const response = applyFont(`🔹 ${botName} Speed: ${ping} ms`);

            await sock.sendMessage(chatId, {
                text: response,
                edit: sentMsg.key
            });

        } catch (error) {
            console.error('Ping error:', error);
            await extra.reply('❌ Failed to measure speed.');
        }
    }
};
