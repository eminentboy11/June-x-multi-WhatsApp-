/**
 * Pair Command - Generate a pairing code for a WhatsApp number
 */

const axios = require('axios');
const { sendButtons } = require('gifted-btns');
const config = require('../../config');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

module.exports = {
    name: 'pair',
    aliases: ['paircode', 'linkdevice'],
    category: 'general',
    description: 'Generate a pairing code to link a WhatsApp number',
    usage: '.pair <number>  e.g. .pair 254712345678',

    async execute(sock, msg, args, extra) {
        const chatId = extra.from;

        try {
            const q = args.join(' ').trim();

            if (!q) {
                await sock.sendMessage(chatId, {
                    text: '⚠️ *Oops!* You forgot the number 😅\n\n👉 Example:\n.pair 25678467XXXX'
                }, { quoted: msg });
                await sock.sendMessage(chatId, { react: { text: '⚠️', key: msg.key } });
                return;
            }

            // Support comma-separated numbers, keep digits only
            const numbers = q.split(',')
                .map(v => v.replace(/[^0-9]/g, ''))
                .filter(v => v.length >= 6 && v.length <= 20);

            if (numbers.length === 0) {
                await sock.sendMessage(chatId, {
                    text: '❌ *Invalid number format!* 🚫\n\n👉 Please use digits only (6–20 digits).'
                }, { quoted: msg });
                await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } });
                return;
            }

            for (const number of numbers) {
                const whatsappID = `${number}@s.whatsapp.net`;
                const result = await sock.onWhatsApp(whatsappID);

                if (!result?.[0]?.exists) {
                    await sock.sendMessage(chatId, {
                        text: `🚫 Number *${number}* is not registered on WhatsApp ❌`
                    });
                    await sock.sendMessage(chatId, { react: { text: '🚫', key: msg.key } });
                    continue;
                }

                await sock.sendMessage(chatId, {
                    text: `⏳ Generating code for: *${number}* 🔐`
                }, { quoted: msg });
                await sock.sendMessage(chatId, { react: { text: '⏳', key: msg.key } });

                try {
                    const response = await axios.get(
                        `https://pair-ultra-ae57185f6550.herokuapp.com/code?number=${number}`,
                        { timeout: 20000 }
                    );

                    const code = response.data?.code;
                    if (!code || code === 'Service Unavailable') {
                        throw new Error('Service Unavailable');
                    }

                    await sleep(3000);

                    await sendButtons(sock, chatId, {
                        text: `🔐 *Pairing Code for ${number}*\n\n\`\`\`${code}\`\`\``,
                        footer: `> Powered by ${config.botName}`,
                        buttons: [
                            {
                                name: 'cta_copy',
                                buttonParamsJson: JSON.stringify({
                                    display_text: '📋 Copy Code',
                                    copy_code: code
                                })
                            }
                        ]
                    }, { quoted: msg });
                 await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });


                } catch (apiError) {
                    console.error('Pair API Error:', apiError.message);
                    const errorMessage = apiError.message === 'Service Unavailable'
                        ? '⚠️ Service is currently unavailable 🙏 Please try again later.'
                        : '❌ Failed to generate pairing code 😔 Please try again later.';

                    await sock.sendMessage(chatId, { text: errorMessage }, { quoted: msg });
                    await sock.sendMessage(chatId, { react: { text: '⚠️', key: msg.key } });
                }
            }

        } catch (error) {
            console.error('Pair command error:', error);
            await sock.sendMessage(chatId, {
                text: '💥 Unexpected error occurred 😵\n\nPlease try again later 🙏'
            }, { quoted: msg });
            await sock.sendMessage(chatId, { react: { text: '💥', key: msg.key } });
        }
    }
};
