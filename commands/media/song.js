const yts = require('yt-search');
const APIs = require('../../utils/api');

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

            const isUrl = searchQuery.startsWith('http://') || searchQuery.startsWith('https://');
            let audioData = null;

            if (!isUrl) {
                try {
                    audioData = await APIs.getIzumiDownloadByQuery(searchQuery);
                } catch (e) {}
            }

            if (!audioData) {
                let videoUrl = searchQuery;

                if (!isUrl) {
                    const { videos } = await yts(searchQuery);
                    if (!videos || videos.length === 0) {
                        return await sock.sendMessage(chatId, {
                            text: 'No songs found!'
                        }, { quoted: msg });
                    }
                    videoUrl = videos[0].url;
                }

                const apiFns = [
                    () => APIs.getApisKeithAudioByUrl(videoUrl),
                    () => APIs.getIzumiDownloadByUrl(videoUrl),
                    () => APIs.getEliteProTechDownloadByUrl(videoUrl),
                    () => APIs.getYupraDownloadByUrl(videoUrl),
                    () => APIs.getOkatsuDownloadByUrl(videoUrl),
                ];

                for (const fn of apiFns) {
                    try {
                        const result = await fn();
                        if (result && result.download) {
                            audioData = result;
                            break;
                        }
                    } catch (e) {
                        continue;
                    }
                }
            }

            if (!audioData || !audioData.download) {
                return await sock.sendMessage(chatId, {
                    text: 'Failed to fetch audio. Please try again later.'
                }, { quoted: msg });
            }

            const title = audioData.title || searchQuery;

            await sock.sendMessage(chatId, {
                text: `_Downloading 🎵_\n_${title} 🎶_`
            }, { quoted: msg });

            await sock.sendMessage(chatId, {
                document: { url: audioData.download },
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
