const yts = require('yt-search');

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

        await extra.react('🔎');

        // Step 1: run the search safely — yt-search itself can throw
        // (e.g. "title.trim is not a function") when YouTube returns a
        // malformed result like a Mix/Shelf/Short with a non-string title.
        let searchResults;
        try {
            searchResults = await yts(query);
        } catch (err) {
            console.error('[ytsearch] yt-search threw internally:', err.message);
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

            // Step 2: sanitize every entry — coerce/validate fields instead
            // of trusting the library's output shape.
            const videos = rawVideos
                .filter(v => v && typeof v.title === 'string' && v.title.trim().length > 0 && v.url)
                .slice(0, 15)
                .map(v => ({
                    title: String(v.title).trim(),
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
            console.error('[ytsearch]', error.message);
            extra.reply(
                `☆━━━━━━━━━━━━━━━☆\n` +
                `       ★ ERROR ★\n` +
                `☆━━━━━━━━━━━━━━━☆\n` +
                `◈ ${error.message}`
            );
        }
    }
};
