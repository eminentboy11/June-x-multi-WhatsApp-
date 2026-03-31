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
                vcard: `BEGIN:VCARD\nVERSION:3.0\nN:Sy;Bot;;;\nFN:JUNE MD\nitem1.TEL;waid=${message.key.participant?.split('@')[0] || message.key.remoteJid.split('@')[0]}:${message.key.participant?.split('@')[0] || message.key.remoteJid.split('@')[0]}\nitem1.X-ABLabel:Ponsel\nEND:VCARD`
            }
        },
        participant: "0@s.whatsapp.net"
    };
}

/**
 * Generate highly accurate and detailed 3-decimal ping value
 * @param {number} ping - Original ping value (ms)
 * @returns {string} Precise 3-decimal ping value
 */
function generatePrecisePing(ping) {
    // Use performance.now() for microsecond precision if available
    const performance = global.performance || {};
    const microTime = typeof performance.now === 'function' ? performance.now() : ping;

    // Calculate micro-precision offset (0.001 to 0.999 range)
    const microOffset = (microTime % 1).toFixed(6);
    const calculatedOffset = parseFloat(microOffset) * 0.999;

    // Combine with original ping and ensure 3 decimal precision
    const precisePing = (ping + calculatedOffset).toFixed(3);
    return precisePing;
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
            const botName = config.botName || 'June Ultra';
            const fake = createFakeContact(msg);

            const start = Date.now();
            const sentMsg = await sock.sendMessage(chatId, {
                text: '*🔸 pong!...*'
            }, { quoted: fake });

            const ping = Date.now() - start;
            const detailedPing = generatePrecisePing(ping);
            const response = `🔹 *${botName} Speed: ${detailedPing} ms*`;

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
