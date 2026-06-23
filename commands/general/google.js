/**
 * Google Search Command
 */

const fetchJSON = async (url) => (await fetch(url)).json();

const react = (sock, msg, emoji) =>
    sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } });

const send = (sock, msg, text) =>
    sock.sendMessage(msg.key.remoteJid, { text }, { quoted: msg });

// ── Config ────────────────────────────────────────────────────────────────────

// Free Google Search API — no key needed
const BASE = 'https://api.giftedtech.co.ke/api/search/googlesearch?apikey=gifted&q=';

// ── Commands ──────────────────────────────────────────────────────────────────

module.exports = [

    {
        name: 'google',
        aliases: ['search', 'g', 'gsearch'],
        category: 'general',
        description: 'Search Google and get top results',
        usage: '.google <query>',

        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply(
                '❌ *Please provide a search query*\n\n' +
                '*Usage:* .google <query>\n' +
                '*Example:* .google How to learn JavaScript'
            );

            await react(sock, msg, '🔍');
            await extra.reply('⏳ *Searching Google...*');

            try {
                const data = await fetchJSON(`${BASE}${encodeURIComponent(query)}`);

                if (!data.success || !data.results?.length) {
                    await react(sock, msg, '❌');
                    return extra.reply(`❌ No results found for *"${query}"*`);
                }

                const results = data.results.slice(0, 5);

                let text =
                    `🔍 *Google Search*\n` +
                    `📝 Query: *${query}*\n` +
                    `📊 Showing top *${results.length}* results\n\n` +
                    `━━━━━━━━━━━━━━━━━━\n\n`;

                results.forEach((r, i) => {
                    text +=
                        `*${i + 1}. ${r.title || 'No Title'}*\n` +
                        `📄 ${r.description || r.snippet || 'No description available.'}\n` +
                        `🔗 ${r.url || r.link || 'N/A'}\n\n`;
                });

                text += `━━━━━━━━━━━━━━━━━━\n_Powered by Google Search_`;

                await send(sock, msg, text);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[google]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Search failed. Please try again later.');
            }
        },
    },

    {
        name: 'image2',
        aliases: ['imagesearch2', 'img2', 'gimage'],
        category: 'general',
        description: 'Search Google Images and get top result',
        usage: '.image <query>',

        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply(
                '❌ *Please provide a search query*\n\n' +
                '*Usage:* .image <query>\n' +
                '*Example:* .image sunset over mountains'
            );

            await react(sock, msg, '🖼️');
            await extra.reply('⏳ *Searching Google Images...*');

            try {
                const data = await fetchJSON(
                    `https://api.giftedtech.co.ke/api/search/googleimagesearch?apikey=gifted&q=${encodeURIComponent(query)}`
                );

                if (!data.success || !data.results?.length) {
                    await react(sock, msg, '❌');
                    return extra.reply(`❌ No images found for *"${query}"*`);
                }

                const images  = data.results.slice(0, 4);
                let   sent    = 0;

                for (const img of images) {
                    const url = img.image || img.url || img.thumbnail;
                    if (!url) continue;

                    try {
                        await sock.sendMessage(
                            msg.key.remoteJid,
                            {
                                image:   { url },
                                caption: sent === 0
                                    ? `🖼️ *Google Images*\n🔍 Query: *${query}*\n\n_Result ${sent + 1} of ${images.length}_`
                                    : `_Result ${sent + 1} of ${images.length}_`,
                            },
                            { quoted: sent === 0 ? msg : undefined }
                        );
                        sent++;
                    } catch {
                        // skip broken image URLs silently
                    }
                }

                if (sent === 0) {
                    await react(sock, msg, '❌');
                    return extra.reply('❌ Could not load any images. Please try again.');
                }

                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[image]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Image search failed. Please try again later.');
            }
        },
    },

    {
        name: 'define',
        aliases: ['meaning', 'definition', 'dict'],
        category: 'general',
        description: 'Search Google for the definition of a word',
        usage: '.define <word>',

        async execute(sock, msg, args, extra) {
            const word = args.join(' ').trim();
            if (!word) return extra.reply(
                '❌ *Please provide a word*\n\n' +
                '*Usage:* .define <word>\n' +
                '*Example:* .define photosynthesis'
            );

            await react(sock, msg, '📖');

            try {
                // Use free dictionary API
                const data = await fetchJSON(
                    `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`
                );

                if (!Array.isArray(data) || !data.length) {
                    await react(sock, msg, '❌');
                    return extra.reply(`❌ No definition found for *"${word}"*`);
                }

                const entry    = data[0];
                const phonetic = entry.phonetic || entry.phonetics?.find(p => p.text)?.text || '';

                let text =
                    `📖 *${entry.word}* ${phonetic ? `_(${phonetic})_` : ''}\n\n`;

                entry.meanings?.slice(0, 3).forEach((m) => {
                    text += `🔹 *${m.partOfSpeech}*\n`;

                    m.definitions?.slice(0, 2).forEach((d, i) => {
                        text += `   ${i + 1}. ${d.definition}\n`;
                        if (d.example) text += `   _"${d.example}"_\n`;
                    });

                    if (m.synonyms?.length) {
                        text += `   ✅ Synonyms: ${m.synonyms.slice(0, 5).join(', ')}\n`;
                    }
                    if (m.antonyms?.length) {
                        text += `   ❌ Antonyms: ${m.antonyms.slice(0, 5).join(', ')}\n`;
                    }

                    text += '\n';
                });

                text += `━━━━━━━━━━━━━━━━━━\n_Powered by Free Dictionary API_`;

                await send(sock, msg, text);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[define]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Definition lookup failed. Please try again later.');
            }
        },
    },

    {
        name: 'news2',
        aliases: ['gnews', 'latestnews'],
        category: 'general',
        description: 'Search Google News for latest articles',
        usage: '.news <topic>',

        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply(
                '❌ *Please provide a news topic*\n\n' +
                '*Usage:* .news <topic>\n' +
                '*Example:* .news Kenya elections'
            );

            await react(sock, msg, '📰');
            await extra.reply('⏳ *Fetching latest news...*');

            try {
                const data = await fetchJSON(
                    `https://api.giftedtech.co.ke/api/search/googlenews?apikey=gifted&q=${encodeURIComponent(query)}`
                );

                if (!data.success || !data.results?.length) {
                    await react(sock, msg, '❌');
                    return extra.reply(`❌ No news found for *"${query}"*`);
                }

                const articles = data.results.slice(0, 5);

                let text =
                    `📰 *Google News*\n` +
                    `🔍 Topic: *${query}*\n\n` +
                    `━━━━━━━━━━━━━━━━━━\n\n`;

                articles.forEach((a, i) => {
                    text +=
                        `*${i + 1}. ${a.title || 'No Title'}*\n` +
                        `🗞️ ${a.source || 'Unknown Source'}\n` +
                        `📅 ${a.date || a.published || 'N/A'}\n` +
                        `🔗 ${a.url || a.link || 'N/A'}\n\n`;
                });

                text += `━━━━━━━━━━━━━━━━━━\n_Powered by Google News_`;

                await send(sock, msg, text);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[news]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ News search failed. Please try again later.');
            }
        },
    },

];
