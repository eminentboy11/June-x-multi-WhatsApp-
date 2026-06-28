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

        await extra.react('☆');

        try {
            const searchResults = await yts(query);
            const videos = searchResults.videos.slice(0, 15);

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
                const duration = video.timestamp || 'N/A';
                const views = video.views ? video.views.toLocaleString() : 'N/A';
                const uploadDate = video.ago || 'N/A';
                const num = String(index + 1).padStart(2, '0');

                resultMessage += `◆ ${num}. ${video.title}\n`;
                resultMessage += `  ◈ ${video.url}\n`;
                resultMessage += `  ◇ Duration : ${duration}\n`;
                resultMessage += `  ◇ Views    : ${views}\n`;
                resultMessage += `  ◇ Uploaded : ${uploadDate}\n`;
                resultMessage += `  ·  ·  ·  ·  ·  ·  ·\n`;
            });

            resultMessage += `\n☆━━━━━━━━━━━━━━━☆\n`;
            resultMessage += `◉ #play <url>  » audio\n`;
            resultMessage += `◉ #video <url> » video\n`;
            resultMessage += `☆━━━━━━━━━━━━━━━☆`;

            const firstVideo = videos[0];
            const thumbnail = firstVideo.thumbnail || firstVideo.image;
            if (thumbnail) {
                await sock.sendMessage(msg.key.remoteJid, {
                    image: { url: thumbnail },
                    caption: resultMessage
                }, { quoted: msg });
            } else {
                await extra.reply(resultMessage);
            }
        } catch (error) {
            console.error('YouTube search error:', error);
            extra.reply(
                `☆━━━━━━━━━━━━━━━☆\n` +
                `       ★ ERROR ★\n` +
                `☆━━━━━━━━━━━━━━━☆\n` +
                `◈ ${error.message}`
            );
        }
    }
};
