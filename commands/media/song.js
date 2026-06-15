const yts = require('yt-search');
const axios = require('axios');

const DOWNLOAD_HEADERS = {
    timeout: 60000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*'
    }
};

const tryRequest = async (getter, attempts = 3) => {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            return await getter();
        } catch (err) {
            lastError = err;
            if (attempt < attempts) await new Promise(r => setTimeout(r, 1000 * attempt));
        }
    }
    throw lastError;
};

const getAudio = async (url) => {
    const res = await tryRequest(() =>
        axios.get(`https://yt-dl.officialhectormanuel.workers.dev/?url=${encodeURIComponent(url)}`, DOWNLOAD_HEADERS)
    );
    if (res?.data?.audio) {
        return {
            download: res.data.audio,
            title: res.data.title,
            thumbnail: res.data.thumbnail
        };
    }
    throw new Error('No audio URL returned');
};

module.exports = {
    name: 'play',
    aliases: ['song', 'yta'],
    category: 'media',
    description: 'Download audio from YouTube',
    usage: '.play <song name or URL>',

    async execute(sock, msg, args, extra) {
        const chatId = extra.from;
        try {
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
                        if (result?.title) {
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
            let audioData = null;
            for (const query of [videoUrl, searchQuery]) {
                try {
                    const result = await getAudio(query);
                    if (result?.download) {
                        audioData = result;
                        break;
                    }
                } catch (e) {
                    continue;
                }
            }

            if (!audioData?.download) {
                return await sock.sendMessage(chatId, {
                    text: '❌ Failed to fetch audio. Please try again later.'
                }, { quoted: msg });
            }

            const finalTitle = audioData.title || title;
            const safeTitle = finalTitle.replace(/[^\w\s\-()]/g, '').trim() || 'audio';

            // --- Send as DOCUMENT ---
            await sock.sendMessage(chatId, {
                document: { url: audioData.download },
                mimetype: 'audio/mpeg',
                fileName: `${safeTitle}.mp3`
            }, { quoted: msg });

            // --- Send as playable AUDIO ---
            await sock.sendMessage(chatId, {
                audio: { url: audioData.download },
                mimetype: 'audio/mpeg',
                ptt: false
            }, { quoted: msg });

            await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });

        } catch (error) {
            console.error('Error in play/song command:', error);
            await sock.sendMessage(chatId, {
                text: '❌ Download failed. Please try again later.'
            }, { quoted: msg });
            await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } });
        }
    }
};
