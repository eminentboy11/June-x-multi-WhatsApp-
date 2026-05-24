/**
 * TikTok Downloader — with format selection buttons (gifted-btns pattern)
 */

const axios = require('axios');
const { sendButtons } = require('gifted-btns');
const config = require('../../config');

const processedMessages = new Set();

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractButtonResponseId(msg) {
    return (
        msg.message?.buttonsResponseMessage?.selectedButtonId ||
        msg.message?.templateButtonReplyMessage?.selectedId ||
        msg.message?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson ||
        null
    );
}

function getResponseSender(msg) {
    return msg.key?.participant || msg.key?.remoteJid;
}

function getTikTokButtons(videoId, dateNow) {
    const prefix = config.prefix || '.';
    return [
        { id: `${prefix}ttvideo_${videoId}_${dateNow}`,    text: '🎬 Video (No Watermark)' },
        { id: `${prefix}ttvideodoc_${videoId}_${dateNow}`, text: '📄 Video as Document'     },
        { id: `${prefix}ttaudio_${videoId}_${dateNow}`,    text: '🎙️ Voice Note (.opus)'    },
    ];
}

function generateWaveform(duration) {
    // 64 amplitude points (0–100) with sine curve + noise — looks like real audio
    return Buffer.from(
        Array.from({ length: 64 }, (_, i) => {
            const base  = Math.sin(i / 5) * 30 + 50;
            const noise = (Math.random() * 30) - 15;
            return Math.min(100, Math.max(5, Math.round(base + noise)));
        })
    );
}

const tiktokPattern = /https?:\/\/(?:(?:www|vm|vt|m)\.)?tiktok\.com\/\S+/i;

// ── Module ────────────────────────────────────────────────────────────────────

module.exports = {
    name: 'tiktok',
    aliases: ['tt', 'ttdl', 'tiktokdl'],
    category: 'media',
    description: 'Download TikTok videos without watermark',
    usage: '.tiktok <TikTok URL>',

    async execute(sock, msg, args, extra) {
        const from = extra.from;

        try {
            // ── Duplicate guard ───────────────────────────────────────────────
            if (processedMessages.has(msg.key.id)) return;
            processedMessages.add(msg.key.id);
            setTimeout(() => processedMessages.delete(msg.key.id), 5 * 60 * 1000);

            // ── Validate input ────────────────────────────────────────────────
            const url = args.join(' ').trim();

            if (!url) {
                return await sock.sendMessage(from, {
                    text: `❌ Please provide a TikTok URL.\n\nUsage: \`${config.prefix || '.'}tiktok <URL>\``
                }, { quoted: msg });
            }

            if (!tiktokPattern.test(url)) {
                return await sock.sendMessage(from, {
                    text: '❌ Invalid TikTok URL. Please send a valid TikTok video link.'
                }, { quoted: msg });
            }

            await sock.sendMessage(from, { react: { text: '⏳', key: msg.key } });

            // ── Fetch video metadata ──────────────────────────────────────────
            const apiResponse = await axios.get('https://www.tikwm.com/api/', {
                params: { url, hd: 1 },
                timeout: 15000,
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });

            const { code, msg: apiMsg, data } = apiResponse.data;

            if (code !== 0 || !data) {
                console.error('[tiktok] API error:', apiMsg);
                return await sock.sendMessage(from, {
                    text: `❌ Failed to fetch video: ${apiMsg || 'Unknown error'}. Try again later.`
                }, { quoted: msg });
            }

            const dateNow        = Date.now();
            const prefix         = config.prefix || '.';
            const videoId        = data.id || dateNow.toString();
            const originalSender = msg.key?.participant || msg.key?.remoteJid;

            // ── Send format selection buttons ─────────────────────────────────
            await sendButtons(sock, from, {
                title: '📥 TIKTOK DOWNLOADER',
                text:
                    `⿻ *Author:* @${data.author?.unique_id || 'unknown'}\n` +
                    `⿻ *Caption:* ${(data.title || 'N/A').substring(0, 80)}\n` +
                    `⿻ *Duration:* ${data.duration ?? 'N/A'}s\n` +
                    `⿻ *Likes:* ${(data.digg_count ?? 0).toLocaleString()}\n` +
                    `⿻ *Comments:* ${(data.comment_count ?? 0).toLocaleString()}\n` +
                    `⿻ *Shares:* ${(data.share_count ?? 0).toLocaleString()}\n\n` +
                    `*Select download format:*`,
                footer: `Made by ${config.botName}`,
                buttons: getTikTokButtons(videoId, dateNow),
            }, { quoted: msg });

            await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });

            // ── Listen for button response ────────────────────────────────────
            const handleResponse = async (event) => {
                const messageData = event.messages[0];
                if (!messageData?.message) return;

                const selectedButtonId = extractButtonResponseId(messageData);
                if (!selectedButtonId) return;

                // Only handle buttons from this specific session
                if (!selectedButtonId.includes(`_${dateNow}`)) return;

                // Only handle responses from this chat
                if (messageData.key?.remoteJid !== from) return;

                // In groups, only the original sender may tap
                const responseSender = getResponseSender(messageData);
                if (from.endsWith('@g.us') && responseSender !== originalSender) return;

                await sock.sendMessage(from, { react: { text: '⬇️', key: msg.key } });

                try {
                    const buttonType = selectedButtonId
                        .replace(prefix, '')  // strip prefix
                        .split('_')[0];       // "ttvideo" | "ttvideodoc" | "ttaudio"

                    const videoUrl = data.hdplay || data.play || data.wmplay;
                    const audioUrl = data.music  || data.play;

                    if (!videoUrl) throw new Error('No download URL found in API response.');

                    const caption =
                        `🎵 *${data.title || 'TikTok Video'}*\n` +
                        `👤 @${data.author?.unique_id || 'unknown'}\n` +
                        `> ${config.botName}`;

                    // ── 🎬 Video (no watermark) ───────────────────────────────
                    if (buttonType === 'ttvideo') {
                        await sock.sendMessage(from, {
                            video: { url: videoUrl },
                            mimetype: 'video/mp4',
                            caption,
                        }, { quoted: messageData });

                    // ── 📄 Video as Document ──────────────────────────────────
                    } else if (buttonType === 'ttvideodoc') {
                        await sock.sendMessage(from, {
                            document: { url: videoUrl },
                            mimetype: 'video/mp4',
                            fileName: `${data.author?.unique_id || 'tiktok'}_${videoId}.mp4`,
                            caption,
                        }, { quoted: messageData });

                    // ── 🎙️ Voice Note (.opus) ─────────────────────────────────
                    } else if (buttonType === 'ttaudio') {
                        if (!audioUrl) throw new Error('No audio URL available for this video.');

                        // Fetch TikTok cover for the circular thumbnail
                        let thumbBuffer;
                        try {
                            const thumbRes = await axios.get(
                                data.cover || data.origin_cover, {
                                    responseType: 'arraybuffer',
                                    timeout: 10000,
                                    headers: { 'User-Agent': 'Mozilla/5.0' }
                                }
                            );
                            thumbBuffer = Buffer.from(thumbRes.data);
                        } catch {
                            thumbBuffer = null; // silently skip if thumb fails
                        }

                        // 64-point sine-based waveform for animated bars
                        const waveform = generateWaveform(data.duration);

                        await sock.sendMessage(from, {
                            audio: { url: audioUrl },
                            mimetype: 'audio/ogg; codecs=opus',
                            ptt: true,
                            seconds: data.duration || 30,
                            waveform,
                            ...(thumbBuffer && { jpegThumbnail: thumbBuffer }),
                        }, { quoted: messageData });
                    }

                    await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });

                } catch (err) {
                    console.error('[tiktok] download error:', err.message);
                    await sock.sendMessage(from, { react: { text: '❌', key: msg.key } });
                    await sock.sendMessage(from, {
                        text: `🚫 Error: ${err.message}\n\n_Try again later._`
                    }, { quoted: messageData });
                }
            };

            sock.ev.on('messages.upsert', handleResponse);

        } catch (error) {
            console.error('[tiktok] command error:', error.message || error);
            await sock.sendMessage(from, {
                text: '❌ An unexpected error occurred. Please try again.'
            }, { quoted: msg });
        }
    }
};
