/**
 * IMG Command — powered by api.cod3uchiha.com/downloaders/img
 */

const axios = require('axios');

const MAX_LIMIT = 10;
const DEFAULT_LIMIT = 5;
const SEND_DELAY = 700;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function react(sock, from, key, emoji) {
    await sock.sendMessage(from, { react: { text: emoji, key } });
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function searchImages(query, limit) {
    const url = `https://api.cod3uchiha.com/downloaders/img?text=${encodeURIComponent(query)}&_limit=${limit}`;
    const { data } = await axios.get(url, { timeout: 30000 });
    if (!data?.status || !data?.result?.images?.length) {
        throw new Error('No images found');
    }
    return data.result;
}

// ── Module ────────────────────────────────────────────────────────────────────

module.exports = [
    {
        name: 'img',
        aliases: ['image', 'images', 'imgsearch'],
        category: 'general',
        description: 'Search and send images from the web',
        usage: '.img <query> [limit]',

        async execute(sock, msg, args, extra) {
            const from = extra.from;

            if (!args.length) {
                return extra.reply(
                    `🖼️ *Image Search*\n\n` +
                    `*Usage:*\n` +
                    `• \`.img zoo\` — search + send ${DEFAULT_LIMIT} images\n` +
                    `• \`.img zoo 8\` — search + send up to 8 images (max ${MAX_LIMIT})`
                );
            }

            let limit = DEFAULT_LIMIT;
            const lastArg = args[args.length - 1];
            if (/^\d+$/.test(lastArg)) {
                limit = Math.min(Math.max(parseInt(lastArg, 10), 1), MAX_LIMIT);
                args = args.slice(0, -1);
            }

            const query = args.join(' ').trim();
            if (!query) {
                return extra.reply('🖼️ Provide a search term.\nExample: `.img zoo`');
            }
            if (query.length > 100) {
                return extra.reply('📝 Search term too long! Max 100 chars.');
            }

            await react(sock, from, msg.key, '🖼️');

            let result;
            try {
                result = await searchImages(query, limit);
            } catch (e) {
                console.error('[img]', e.message);
                await react(sock, from, msg.key, '❌');
                return extra.reply(`❌ Search failed: ${e.message}`);
            }

            const images = result.images.slice(0, limit);

            try {
                for (let i = 0; i < images.length; i++) {
                    const img = images[i];
                    await sock.sendMessage(from, {
                        image: { url: img.url },
                        caption: `🖼️ ${img.title || query} (${i + 1}/${images.length})`,
                    }, { quoted: msg });

                    if (i < images.length - 1) await sleep(SEND_DELAY);
                }

                await react(sock, from, msg.key, '✅');
            } catch (e) {
                console.error('[img]', e.message);
                await react(sock, from, msg.key, '❌');
                await sock.sendMessage(from, {
                    text: `🚫 Error sending images: ${e.message}`,
                }, { quoted: msg });
            }
        },
    },
];
