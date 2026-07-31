const yts = require('yt-search');

// yt-search occasionally throws "title.trim is not a function" (or similar)
// internally when YouTube returns a malformed/shelf-type result (Mix, Shorts,
// promoted content, etc). This wrapper retries once and never lets that
// crash escape unhandled.
async function safeSearch(query, attempt = 1) {
    try {
        return await yts(query);
    } catch (err) {
        console.error(`[ytsearch] yts() failed (attempt ${attempt}):`, err.stack || err.message);
        if (attempt < 2) {
            // Small delay then retry once — often transient / a single bad shelf item
            await new Promise(r => setTimeout(r, 800));
            return safeSearch(query, attempt + 1);
        }
        throw err;
    }
}

module.exports = {
    name: 'ytsearch',
    aliases: ['youtubesearch', 'yts'],
    category: 'media',
    description: 'Search YouTube videos',
    usage: '.ytsearch <query>',

    async execute(sock, msg, args, extra) {
        const query = args.join(' ');
        if (!query) {
            return extra.reply(
                '☆━━━━━━━━━━━━━━━☆\n' +
                '   ★ YOUTUBE SEARCH ★\n' +
                '☆━━━━━━━━━━━━━━━☆\n\n' +
                '◈ Usage  : .ytsearch <query>\n\n' +
                '◉ Examples:\n' +
                '  ▸ .ytsearch Godzilla\n' +
                '  ▸ .ytsearch latest songs'
            );
        }

        await extra.react('☆');

        let searchResults;
        try {
            searchResults = await safeSearch(query);
        } catch (err) {
            console.error('[ytsearch] final failure after retry:', err.stack || err.message);
            return extra.reply(
                '☆━━━━━━━━━━━━━━━☆\n' +
                '       ★ ERROR ★\n' +
                '☆━━━━━━━━━━━━━━━☆\n' +
                '◈ YouTube search is glitching right now.\n' +
                '▸ Try rephrasing the query or search again shortly.'
            );
        }

        try {
            const rawVideos = Array.isArray(searchResults?.videos) ? searchResults.videos : [];

            // Sanitize every entry — coerce/validate before touching any field,
            // so a malformed item can never crash string/number methods.
            const videos = rawVideos
                .filter(v => v && typeof v.title === 'string' && v.title.trim().length > 0 && v.url)
                .slice(0, 15)
                .map(v => ({
                    title: v.title.trim(),
                    url: String(v.url),
                    timestamp: typeof v.timestamp === 'string' ? v.timestamp : 'N/A',
                    views: typeof v.views === 'number' ? v.views.toLocaleString() : 'N/A',
                    ago: typeof v.ago === 'string' ? v.ago : 'N/A',
                    thumbnail: v.thumbnail || v.image || null
                }));

            if (videos.length === 0) {
                return extra.reply(
                    '◈ No results found for:\n' +
                    `  "${query}"\n\n` +
                    '▸ Try different keywords.'
                );
            }

            let resultMessage = `☆━━━━━━━━━━━━━━━☆\n`;
            resultMessage +=    ` ★ YOUTUBE SEARCH ★\n`;
            resultMessage +=    `☆━━━━━━━━━━━━━━━☆\n`;
            resultMessage +=    `◈ Query » ${query}\n\n`;

            videos.forEach((video, index) => {
                const num = String(index + 1).padStart(2, '0');
                resultMessage += `◆ ${num}. ${video.title}\n`;
                resultMessage += `  ◈ ${video.url}\n`;
                resultMessage += `  ◇ Duration : ${video.timestamp}\n`;
                resultMessage += `  ◇ Views    : ${video.views}\n`;
                resultMessage += `  ◇ Uploaded : ${video.ago}\n`;
                resultMessage += `  ·  ·  ·  ·  ·  ·  ·\n`;
            });

            resultMessage += `\n☆━━━━━━━━━━━━━━━☆\n`;
            resultMessage += `◉ #play <url>  » audio\n`;
            resultMessage += `◉ #video <url> » video\n`;
            resultMessage += `☆━━━━━━━━━━━━━━━☆`;

            const thumbnail = videos[0].thumbnail;
            if (thumbnail) {
                await sock.sendMessage(msg.key.remoteJid, {
                    image: { url: thumbnail },
                    caption: resultMessage
                }, { quoted: msg });
            } else {
                await extra.reply(resultMessage);
            }
        } catch (error) {
            console.error('[ytsearch]', error.stack || error.message);
            extra.reply(
                `☆━━━━━━━━━━━━━━━☆\n` +
                `       ★ ERROR ★\n` +
                `☆━━━━━━━━━━━━━━━☆\n` +
                `◈ ${error.message}`
            );
        }
    }
};
