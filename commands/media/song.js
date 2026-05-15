const yts = require('yt-search');
const APIs = require('../../utils/api');

module.exports = {
    name: 'song',
    aliases: ['play', 'music', 'yta'],
    category: 'media',
    description: 'Download audio from YouTube',
    usage: '.play <song name or URL>',

    async execute(sock, msg, args, extra) {
        try {
            const chatId = extra.from;
            const searchQuery = args.join(' ').trim();

            if (!searchQuery) {
                return await sock.sendMessage(chatId, {
                    text: '🎵 Please provide a song name or YouTube URL.'
                }, { quoted: msg });
            }

            await sock.sendMessage(chatId, {
                react: { text: '🎼', key: msg.key }
            });

            const isUrl = searchQuery.startsWith('http://') || searchQuery.startsWith('https://');
            let videoUrl = searchQuery;
            let title = searchQuery;
            let duration = '';
            let views = '';
            let thumbnail = '';
            let author = '';

            // --- Metadata extraction ---
            if (!isUrl) {
                const { videos } = await yts(searchQuery);
                if (!videos || videos.length === 0) {
                    return await sock.sendMessage(chatId, {
                        text: '❌ No songs found for that search.'
                    }, { quoted: msg });
                }
                const found = videos[0];
                videoUrl = found.url;
                title = found.title;
                duration = found.timestamp || '';
                views = found.views ? found.views.toLocaleString() : '';
                thumbnail = found.thumbnail || '';
                author = found.author?.name || '';
            } else {
                try {
                    const ytId = (videoUrl.match(/(?:youtu\.be\/|v=)([a-zA-Z0-9_-]{11})/) || [])[1];
                    if (ytId) {
                        const result = await yts({ videoId: ytId });
                        if (result && result.title) {
                            title = result.title;
                            duration = result.timestamp || '';
                            views = result.views ? result.views.toLocaleString() : '';
                            thumbnail = result.thumbnail || '';
                            author = result.author?.name || '';
                        }
                    }
                } catch (e) {}
            }

            // --- Audio download ---
            const apiFns = [
                () => APIs.getApisKeithAudioByUrl(videoUrl),
                () => APIs.getIzumiDownloadByUrl(videoUrl),
                () => APIs.getEliteProTechDownloadByUrl(videoUrl),
                () => APIs.getYupraDownloadByUrl(videoUrl),
                () => APIs.getOkatsuDownloadByUrl(videoUrl),
            ];

            let audioData = null;
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

            if (!audioData || !audioData.download) {
                return await sock.sendMessage(chatId, {
                    text: '❌ Failed to fetch audio. Please try again later.'
                }, { quoted: msg });
            }

            const safeTitle = title.replace(/[^\w\s\-()]/g, '').trim() || 'audio';

            // --- Send as DOCUMENT (no caption) ---
            await sock.sendMessage(chatId, {
                document: { url: audioData.download },
                mimetype: 'audio/mpeg',
                fileName: `${safeTitle}.mp3`
            }, { quoted: msg });

            // --- Send as AUDIO (no caption, playable) ---
            await sock.sendMessage(chatId, {
                audio: { url: audioData.download },
                mimetype: 'audio/mpeg',
                ptt: false   // set true for voice note style
            }, { quoted: msg });

        } catch (error) {
            console.error('Error in play/song command:', error);
            await sock.sendMessage(msg.key.remoteJid, {
                text: '❌ Download failed. Please try again later.'
            }, { quoted: msg });
        }
    }
};
