/**
 * LLaMA Command
 * Chat with Meta's LLaMA AI
 */

const axios = require('axios');

module.exports = {
    name: 'llama',
    aliases: ['llama3'],
    category: 'tools',
    description: 'Chat with LLaMA AI',
    usage: '.llama <question>',

    async execute(sock, msg, args, extra) {
        try {
            const text = args.join(' ').trim();
            if (!text) return extra.reply('❌ Please type a message.\nExample: `.llama hello`');

            await extra.reply('🦙 Asking LLaMA...');

            const response = await axios.get(`https://apiskeith.vercel.app/ai/ilama?q=${encodeURIComponent(text)}`);
            const replyText = response.data?.result;
            if (!replyText) return extra.reply('⚠️ No response from LLaMA. Try again later.');

            await sock.sendMessage(extra.from, {
                text: `🦙 *LLaMA says:*\n\n${replyText}`
            }, { quoted: msg });

        } catch (error) {
            console.error('LLaMA API Error:', error.message);
            await extra.reply('💥 API error! Try again later.');
        }
    }
};
