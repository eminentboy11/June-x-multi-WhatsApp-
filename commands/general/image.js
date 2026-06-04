/**
 * Image Search Command - Search and send images via PopCat API (free, no key)
 * Fallback: Pixabay API (set PIXABAY_KEY in .env for better results)
 */

const axios = require('axios');
const config = require('../../config');

const POPCAT_API  = 'https://api.popcat.xyz/image/search';
const PIXABAY_API = 'https://pixabay.com/api/';

// ── Fetch image URLs from PopCat (no API key needed) ──────────
async function fetchFromPopCat(query, limit = 10) {
    const { data } = await axios.get(POPCAT_API, {
        params: { q: query, limit },
        timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    if (!Array.isArray(data) || !data.length) throw new Error('No results');

    return data.map(r => r.url).filter(Boolean);
}

// ── Fetch image URLs from Pixabay (free key required) ─────────
async function fetchFromPixabay(query, limit = 10) {
    const key = process.env.PIXABAY_KEY;
    if (!key) throw new Error('PIXABAY_KEY not set');

    const { data } = await axios.get(PIXABAY_API, {
        params: {
            key,
            q: query,
            image_type: 'photo',
            per_page: limit,
            safesearch: true
        },
        timeout: 10000
    });

    const hits = data?.hits || [];
    if (!hits.length) throw new Error('No results');

    return hits.map(h => h.largeImageURL).filter(Boolean);
}

// ── Validate URL is a reachable image ─────────────────────────
function isValidImageUrl(url) {
    try {
        new URL(url);
        return url.startsWith('http');
    } catch {
        return false;
    }
}

module.exports = {
    name: 'image',
    aliases: ['images', 'img', 'imgsearch', 'gimage'],
    category: 'general',
    description: 'Search images and send up to 5 results',
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
            let rawUrls = [];

            // ── Source 1: PopCat (no key needed) ───────────────
            try {
                rawUrls = await fetchFromPopCat(query, 15);
            } catch (e1) {
                console.warn('[image] PopCat failed:', e1.message);

                // ── Source 2: Pixabay (optional .env key) ───────
                try {
                    rawUrls = await fetchFromPixabay(query, 15);
                } catch (e2) {
                    console.warn('[image] Pixabay failed:', e2.message);
                }
            }

            if (!rawUrls.length) {
                return await sock.sendMessage(chatId, {
                    text: `❌ No images found for *"${query}"*`
                }, { quoted: msg });
            }

            // Filter valid URLs and take up to 5
            const imageUrls = rawUrls
                .filter(isValidImageUrl)
                .slice(0, 5);

            if (!imageUrls.length) {
                return await sock.sendMessage(chatId, {
                    text: `❌ No valid images found for *"${query}"*`
                }, { quoted: msg });
            }

            const botName = config.botName || 'Bot';

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
