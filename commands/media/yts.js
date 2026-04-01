const yts = require('yt-search');

module.exports = {
    name: 'ytsearch',
    aliases: ['youtubesearch', 'yts'],
    category: 'search',
    description: 'Search YouTube videos',
    usage: '.ytsearch <query>',

    async execute(sock, msg, args, extra) {
        const query = args.join(' ');
        if (!query) {
            return extra.reply('🔍 *YouTube Search Command*\n\nUsage:\n.ytsearch <search_query>\n\nExample:\n.ytsearch Godzilla\n.ytsearch latest songs');
        }

        await extra.react('▶️');

        try {
            const searchResults = await yts(query);
            const videos = searchResults.videos.slice(0, 15); // limit to 15 results

            if (videos.length === 0) {
                return extra.reply(`❌ No results found for "${query}"\n\nTry different keywords.`);
            }

            let resultMessage = `▶️ *YouTube: "${query}"*\n━━━━━━━━━━━━━━━\n\n`;

            videos.forEach((video, index) => {
                const duration = video.timestamp || 'N/A';
                const views = video.views ? video.views.toLocaleString() : 'N/A';
                const uploadDate = video.ago || 'N/A';

                resultMessage += `${index + 1}. *${video.title}*\n`;
                resultMessage += `   ⏱ Duration: ${duration}\n`;
                resultMessage += `   👁 Views: ${views}\n`;
                resultMessage += `   📅 Uploaded: ${uploadDate}\n`;
                resultMessage += `   🔗 URL: ${video.url}\n\n`;
            });

            resultMessage += `☆ Tip: Use \`#play <url>\` to download audio\n`;
            resultMessage += `☆ Use \`#video <url>\` to download video`;

            // Optionally send thumbnail of first video if available
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
            extra.reply(`❌ Error searching YouTube: ${error.message}`);
        }
    }
};
