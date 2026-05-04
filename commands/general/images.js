/**
 * Image Search Command - Search and send Google Images via apiskeith API
 */

const axios = require('axios');
const config = require(require('path').join(global.__ROOT__, 'config'));

const IMAGE_API = 'https://apiskeith.top/search/images';

module.exports = {
    name: 'image',
    aliases: ['images', 'img', 'imgsearch', 'gimage'],
    category: 'general',
    description: 'Search Google Images and send up to 5 results',
    usage: '.image <query>',

    async execute(sock, msg, args, extra) {
        const chatId = extra.from;
        const query  = args.join(' ').trim();

        if (!query) {
            return extra.reply(
                `📷 *Image Search*\n\n` +
                `Usage: \`.image <search query>\`\n\n` +
                `Examples:\n` +
                `  • \`.image sunset\`\n` +
                `  • \`.image anime characters\`\n` +
                `  • \`.image cute cats\``
            );
        }

        await extra.react('🔍');
        await extra.reply(`🔍 Searching images for: *"${query}"*...`);

        try {
            const { data } = await axios.get(IMAGE_API, {
                params: { query },
                timeout: 10000
            });

            // Handle both array response and { results: [] } shaped response
            const rawResults = Array.isArray(data) ? data : (data.results ?? data.images ?? []);

            if (!rawResults || rawResults.length === 0) {
                return await sock.sendMessage(chatId, {
                    text: `❌ No images found for *"${query}"*`
                }, { quoted: msg });
            }

            // Normalize: support { url } or { image } or plain string
            const imageUrls = rawResults
                .map(r => (typeof r === 'string' ? r : r.url ?? r.image ?? r.link ?? ''))
                .filter(url => url && /^https?:\/\/.+\.(jpg|jpeg|png|webp)(\?.*)?$/i.test(url))
                .slice(0, 5);

            if (imageUrls.length === 0) {
                return await sock.sendMessage(chatId, {
                    text: `❌ No valid images found for *"${query}"*`
                }, { quoted: msg });
            }

            const botName = config.botName || 'June-Ultra';

            for (const url of imageUrls) {
                try {
                    await sock.sendMessage(chatId, {
                        image: { url },
                        caption: `📸 Downloaded by *${botName}*`
                    }, { quoted: msg });
                    await new Promise(res => setTimeout(res, 500));
                } catch (err) {
                    console.error('Error sending image:', err.message);
                }
            }

            await extra.react('✅');

        } catch (error) {
            console.error('Image command error:', error);

            const errMsg = error.response
                ? `API error ${error.response.status}: ${error.response.statusText}`
                : error.message || 'Unknown error';

            await sock.sendMessage(chatId, {
                text: `❌ Image search failed: ${errMsg}`
            }, { quoted: msg });
            await extra.react('❌');
        }
    }
};
