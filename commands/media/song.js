const yts = require('yt-search');
const axios = require('axios');

module.exports = {
    name: 'song',
    aliases: ['play', 'music', 'yta'],
    category: 'media',
    description: 'Download audio from YouTube',
    usage: '.play <song name>',

    async execute(sock, msg, args, extra) {
        try {
            const chatId = extra.from;
            const searchQuery = args.join(' ').trim();

            if (!searchQuery) {
                return await sock.sendMessage(chatId, {
                    text: 'What song do you want to download?'
                }, { quoted: msg });
            }

            await sock.sendMessage(chatId, {
                react: { text: '🎼', key: msg.key }
            });

            const { videos } = await yts(searchQuery);
            if (!videos || videos.length === 0) {
                return await sock.sendMessage(chatId, {
                    text: 'No songs found!'
                }, { quoted: msg });
            }

            const video = videos[0];
            const urlYt = video.url;
            const title = video.title;

            await sock.sendMessage(chatId, {
                text: `_Downloading 🎵_\n_${title} 🎶_`
            }, { quoted: msg });

            const apis = [
                { url: `https://apiskeith.top/download/audio?url=${encodeURIComponent(urlYt)}`, parse: (d) => d.status ? d.result : null },
                { url: `https://apis.xwolf.space/download/audio?url=${encodeURIComponent(urlYt)}`, parse: (d) => d.success ? d.downloadUrl : null },
                { url: `https://api.giftedtech.co.ke/api/download/dlmp3?apikey=gifted&url=${encodeURIComponent(urlYt)}`, parse: (d) => d.status && d.result ? d.result.download_url : null }
            ];

            let audioUrl = null;
            for (const api of apis) {
                try {
                    const response = await axios.get(api.url, { timeout: 30000 });
                    audioUrl = api.parse(response.data);
                    if (audioUrl) break;
                } catch (e) {
                    continue;
                }
            }

            if (!audioUrl) {
                return await sock.sendMessage(chatId, {
                    text: 'Failed to fetch audio from the API. Please try again later.'
                }, { quoted: msg });
            }

            await sock.sendMessage(chatId, {
                document: { url: audioUrl },
                mimetype: 'audio/mpeg',
                fileName: `${title}.mp3`,
                caption: `🎵 *${title}*`
            }, { quoted: msg });

        } catch (error) {
            console.error('Error in play/song command:', error);
            await sock.sendMessage(msg.key.remoteJid, {
                text: 'Download failed. Please try again later.'
            }, { quoted: msg });
        }
    }
};
