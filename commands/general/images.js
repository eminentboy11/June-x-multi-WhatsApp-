/**
 * Image Search Command - Search and send Google Images via g-i-s
 */

const gis = require('g-i-s');
const config = require('../../config');

function gisSearch(query) {
    return new Promise((resolve, reject) => {
        gis(query, (error, results) => {
            if (error) return reject(error);
            resolve(results);
        });
    });
}

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
            const results = await gisSearch(query);

            if (!results || results.length === 0) {
                return await sock.sendMessage(chatId, {
                    text: `❌ No images found for *"${query}"*`
                }, { quoted: msg });
            }

            const imageUrls = results
                .map(r => r.url)
                .filter(url => url && /\.(jpg|jpeg|png|webp)(\?.*)?$/i.test(url))
                .slice(0, 5);

            if (imageUrls.length === 0) {
                return await sock.sendMessage(chatId, {
                    text: `❌ No valid images found for *"${query}"*`
                }, { quoted: msg });
            }

            const botName = config.botName || 'June-X';

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
            await sock.sendMessage(chatId, {
                text: `❌ Image search failed: ${error.message || 'Unknown error'}`
            }, { quoted: msg });
        }
    }
};
