/* by supreme */
const config = require('../../config');

// fakeQuoted function – creates a contact vcard quote
function createFakeContact(message) {
    return {
        key: {
            participants: "0@s.whatsapp.net",
            remoteJid: "",
            fromMe: false,
            id: "JUNE-X"
        },
        message: {
            contactMessage: {
                vcard: `BEGIN:VCARD\nVERSION:3.0\nN:Sy;Bot;;;\nFN:June-Ultra\nitem1.TEL;waid=${message.key.participant?.split('@')[0] || message.key.remoteJid.split('@')[0]}:${message.key.participant?.split('@')[0] || message.key.remoteJid.split('@')[0]}\nitem1.X-ABLabel:Ponsel\nEND:VCARD`
            }
        },
        participant: "0@s.whatsapp.net"
    };
}

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
            const fake = createFakeContact(msg);

            // Use performance.now() for real sub-millisecond precision
            const start = performance.now();
            const sentMsg = await sock.sendMessage(chatId, {
                text: '*🔸 pong!...*'
            }, { quoted: fake });

            const ping = (performance.now() - start).toFixed(3);
            const response = `🔹 *${botName} Speed: ${ping} ms*`;

            await sock.sendMessage(chatId, {
                text: response,
                edit: sentMsg.key
            }, { quoted: fake });

        } catch (error) {
            console.error('Ping error:', error);
            await extra.reply('❌ Failed to measure speed.');
        }
    }
};
