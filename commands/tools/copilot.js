/**
 * Copilot Command
 * Chat with Microsoft Copilot AI
 */

const axios = require('axios');

const API = 'https://api.nexray.web.id';

module.exports = {
    name: 'copilot',
    aliases: ['copilotai'],
    category: 'tools',
    description: 'Chat with Copilot AI',
    usage: '.copilot <question>',

    async execute(sock, msg, args, extra) {
        try {
            const text = args.join(' ').trim();
            if (!text) return extra.reply('Usage: .copilot <your question>');

            await extra.reply('🤖 Asking Copilot...');

            const { data } = await axios.get(`${API}/ai/copilot?text=${encodeURIComponent(text)}`);
            if (!data.status) return extra.reply('❌ Failed to get a response from Copilot.');

            await sock.sendMessage(extra.from, {
                text: `💬 *Copilot says:*\n\n${data.result}`
            }, { quoted: msg });

        } catch (error) {
            console.error('Copilot Error:', error);
            await extra.reply('❌ Error contacting Copilot AI. Try again later.');
        }
    }
};
