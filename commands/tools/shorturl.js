/**
 * Short URL Command
 * Create a short URL from any link using TinyURL
 */

const axios = require('axios');

module.exports = {
    name: 'shorturl',
    aliases: ['shortlink'],
    category: 'tools',
    description: 'Create a short URL from a long link',
    usage: '.shorturl <url>',

    async execute(sock, msg, args, extra) {
        try {
            const url = args.join(' ').trim();
            if (!url) return extra.reply('❌ Please provide a link to shorten!\nExample:\n.shorturl https://google.com');

            const { data } = await axios.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`);
            await extra.reply(`✅ *Shortlink created successfully:*\n\n🔗 ${data}`);
        } catch (error) {
            console.error('SHORTLINK ERROR:', error);
            await extra.reply('❌ Failed to create shortlink: ' + (error.message || error));
        }
    }
};
