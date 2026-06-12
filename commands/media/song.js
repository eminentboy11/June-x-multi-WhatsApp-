const yts = require('yt-search');
const APIs = require('../../utils/api');
const config = require('../../config');
const { sendButtons } = require('gifted-btns');

module.exports = {
    name: 'play',
    aliases: ['song', 'yta'],
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
                            author = result.author?.name || '';
                        }
                    }
                } catch (e) {}
            }

            // --- Audio download ---
            const apiFns = [
                () => APIs.getIzumiDownloadByUrl(videoUrl),
                () => APIs.getEliteProTechDownloadByUrl(videoUrl),
                () => APIs.getIzumiDownloadByQuery(searchQuery),
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

            const finalTitle = audioData.title || title;
            const safeTitle = finalTitle.replace(/[^\w\s\-()]/g, '').trim() || 'audio';

            const dateNow = Date.now();
            const prefix = config.prefix || '.';
            const originalSender = msg.key.participant || msg.key.remoteJid;

            // --- Send buttons with metadata ---
            await sendButtons(sock, chatId, {
                title: `🎵 SONG DOWNLOADER`,
                text:
                    `⿻ *Title:* ${finalTitle}\n` +
                    `⿻ *Duration:* ${duration || 'N/A'}\n` +
                    `⿻ *Views:* ${views || 'N/A'}\n` +
                    `⿻ *Channel:* ${author || 'N/A'}\n` +
                    `⿻ *Link:* ${videoUrl}\n\n` +
                    `*Select download format:*`,
                footer: `Made by ${config.botName}`,
                buttons: [
                    { id: `${prefix}audio_${dateNow}`,    text: '🎶 1. Audio MP3' },
                    { id: `${prefix}audiodoc_${dateNow}`, text: '📄 2. Audio Document' },
                ],
            }, { quoted: msg });

            await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });

            // --- Listen for button response ---
            const handleResponse = async (event) => {
                const messageData = event.messages[0];
                if (!messageData?.message) return;

                const selectedButtonId =
                    messageData.message?.buttonsResponseMessage?.selectedButtonId ||
                    messageData.message?.templateButtonReplyMessage?.selectedId ||
                    messageData.message?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson ||
                    null;

                if (!selectedButtonId) return;
                if (!selectedButtonId.includes(`_${dateNow}`)) return;
                if (messageData.key?.remoteJid !== chatId) return;

                const responseSender = messageData.key?.participant || messageData.key?.remoteJid;
                if (chatId.endsWith('@g.us') && responseSender !== originalSender) return;

                await sock.sendMessage(chatId, { react: { text: '⬇️', key: msg.key } });

                try {
                    const buttonType = selectedButtonId.replace(prefix, '').split('_')[0];

                    if (buttonType === 'audio') {
                        await sock.sendMessage(chatId, {
                            audio: { url: audioData.download },
                            mimetype: 'audio/mpeg',
                        }, { quoted: messageData });

                    } else if (buttonType === 'audiodoc') {
                        await sock.sendMessage(chatId, {
                            document: { url: audioData.download },
                            mimetype: 'audio/mpeg',
                            fileName: `${safeTitle}.mp3`,
                        }, { quoted: messageData });
                    }

                    await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });

                } catch (error) {
                    console.error('[play] send error:', error.message);
                    await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } });
                    await sock.sendMessage(chatId, {
                        text: `🚫 Error: ${error.message}\n\n_Try again later._`,
                    }, { quoted: messageData });
                }
            };

            sock.ev.on('messages.upsert', handleResponse);

        } catch (error) {
            console.error('Error in play/song command:', error);
            await sock.sendMessage(msg.key.remoteJid, {
                text: '❌ Download failed. Please try again later.'
            }, { quoted: msg });
        }
    }
};
