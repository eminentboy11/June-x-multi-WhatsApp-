/**
 * Twitter/X Command — powered by api.hostify.indevs.in
 * Download: GET /api/downloader/x?url=<twitter_url>
 *
 * Response shape:
 * {
 *   success: true,
 *   result: {
 *     title: "...",
 *     results: [
 *       { id, type, thumbnail, url, proxy_link }
 *     ]
 *   }
 * }
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { sendButtons } = require('gifted-btns');
const config = require('../../config');

const RETRY_DELAY = 3000;
const BASE = 'https://api.hostify.indevs.in';

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

function isTwitterUrl(text) {
    return /https?:\/\/(www\.)?(twitter\.com|x\.com)\/[^\s]+/i.test(text);
}

async function withRetry(fn, retries = 3, delayMs = RETRY_DELAY) {
    let lastErr;
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (e) {
            lastErr = e;
            const isBusy = e.message?.toLowerCase().includes('busy') ||
                           e.message?.toLowerCase().includes('try again');
            if (i < retries - 1 && isBusy) {
                await new Promise(r => setTimeout(r, delayMs));
            } else if (!isBusy) {
                throw e;
            }
        }
    }
    throw lastErr;
}

/**
 * Fetch Twitter/X media info
 * Returns: { title, results: [{ id, type, thumbnail, url, proxy_link }] }
 */
async function fetchTwitterMedia(twitterUrl) {
    return withRetry(async () => {
        console.log('[twitter] fetching:', twitterUrl);
        const res = await axios.get(`${BASE}/api/downloader/x`, {
            params:  { url: twitterUrl },
            timeout: 60000,
        });

        if (!res.data?.success || !res.data?.result?.success) {
            throw new Error('API returned success: false');
        }

        const r = res.data.result;
        if (!Array.isArray(r.results) || !r.results.length) {
            throw new Error('No media found in this tweet');
        }

        console.log('[twitter] found', r.results.length, 'media item(s):', r.title);
        return {
            title:   r.title   || '',
            results: r.results,           // [{ id, type, thumbnail, url, proxy_link }]
        };
    });
}

/**
 * Quality/item selection buttons — one per result item
 * ID: <prefix>tw_item_<index>_<dateNow>
 */
function getItemButtons(results, dateNow) {
    const prefix = config.prefix || '.';
    return results.map((item, i) => ({
        id:   `${prefix}tw_item_${i}_${dateNow}`,
        text: `${item.type === 'video' ? '🎬' : '🖼️'} ${item.type === 'video' ? 'Video' : 'Image'} #${item.id}`,
    }));
}

/**
 * Send-as buttons for video
 * ID: <prefix>tw_vfmt_<format>_<index>_<dateNow>
 */
function getVideoFormatButtons(index, dateNow) {
    const prefix = config.prefix || '.';
    return [
        { id: `${prefix}tw_vfmt_video_${index}_${dateNow}`,    text: '🎬 Video' },
        { id: `${prefix}tw_vfmt_videodoc_${index}_${dateNow}`, text: '📄 Video Document' },
    ];
}

/**
 * Send-as buttons for image
 * ID: <prefix>tw_ifmt_<format>_<index>_<dateNow>
 */
function getImageFormatButtons(index, dateNow) {
    const prefix = config.prefix || '.';
    return [
        { id: `${prefix}tw_ifmt_image_${index}_${dateNow}`,    text: '🖼️ Image' },
        { id: `${prefix}tw_ifmt_imagedoc_${index}_${dateNow}`, text: '📄 Image Document' },
    ];
}

// ── Module ────────────────────────────────────────────────────────────────────

module.exports = {
    name: 'twitter',
    aliases: ['tw', 'xdl', 'twdl', 'xdown'],
    category: 'media',
    description: 'Download Twitter/X videos and images',
    usage: '.twitter <tweet url>',

    async execute(sock, msg, args, extra) {
        if (!args.length) {
            return extra.reply(
                `🐦 *Twitter/X Downloader*\n\n` +
                `*Usage:*\n` +
                `• \`.twitter https://twitter.com/user/status/...\` — download media\n` +
                `• \`.twitter https://x.com/user/status/...\` — also works\n` +
                `• Reply to a message with \`.twitter\` — use replied text as link`
            );
        }

        let query = args.join(' ').trim();

        if (!query) {
            const quoted = extra?.quoted;
            query = quoted?.conversation || quoted?.extendedTextMessage?.text || '';
        }

        if (!query) {
            return extra.reply('🐦 Provide a Twitter/X tweet URL.\nExample: `.twitter https://x.com/user/status/123`');
        }

        if (!isTwitterUrl(query)) {
            return extra.reply('❌ Invalid URL. Please provide a valid Twitter/X tweet link.');
        }

        const from           = extra.from;
        const prefix         = config.prefix || '.';
        const originalSender = msg.key.participant || msg.key.remoteJid;

        await sock.sendMessage(from, { react: { text: '🔍', key: msg.key } });

        // ── Step 1: Fetch tweet media info ────────────────────────────────────
        let mediaInfo;
        try {
            mediaInfo = await fetchTwitterMedia(query);
        } catch (e) {
            console.error('[twitter] fetch error:', e.message);
            return extra.reply(`❌ Failed: ${e.message}`);
        }

        const { title, results } = mediaInfo;
        const dateNow = Date.now();

        // ── Step 2: Single item — skip selection, go straight to send-as ──────
        if (results.length === 1) {
            const item = results[0];

            const fmtDateNow = Date.now();
            const isVideo    = item.type === 'video';

            await sendButtons(sock, from, {
                title:   `🐦 TWITTER DOWNLOADER`,
                text:
                    `⿻ *Tweet:* ${title.substring(0, 200)}\n\n` +
                    `⿻ *Type:* ${isVideo ? '🎬 Video' : '🖼️ Image'}\n\n` +
                    `*Select how to receive:*`,
                footer:  `Made by ${config.botName}`,
                buttons: isVideo
                    ? getVideoFormatButtons(0, fmtDateNow)
                    : getImageFormatButtons(0, fmtDateNow),
            }, { quoted: msg });

            await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });

            // Listen for format — persistent, multi-tap
            const handleSingleFormat = async (event) => {
                const fmtMsg = event.messages[0];
                if (!fmtMsg?.message) return;

                const fmtId = extractButtonResponseId(fmtMsg);
                if (!fmtId) return;
                if (!fmtId.includes(`_0_${fmtDateNow}`)) return;
                if (fmtMsg.key?.remoteJid !== from) return;

                const fmtSender = getResponseSender(fmtMsg);
                if (from.endsWith('@g.us') && fmtSender !== originalSender) return;

                // ✅ No sock.ev.off — multi-tap
                await sock.sendMessage(from, { react: { text: '⏬', key: msg.key } });

                try {
                    await downloadAndSend({
                        sock, from, msg: fmtMsg,
                        item, title, fmtId, prefix, dateNow: fmtDateNow,
                    });
                    await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });
                } catch (error) {
                    console.error('[twitter] send error:', error.message);
                    await sock.sendMessage(from, { react: { text: '❌', key: msg.key } });
                    await sock.sendMessage(from, {
                        text: `🚫 Error: ${error.message}\n\n_Try again later._`,
                    }, { quoted: fmtMsg });
                }
            };

            sock.ev.on('messages.upsert', handleSingleFormat);
            // ✅ No setTimeout — no expiry
            return;
        }

        // ── Step 3: Multiple items — show item selection buttons ──────────────
        const itemList = results.map((item, i) =>
            `*${i + 1}.* ${item.type === 'video' ? '🎬 Video' : '🖼️ Image'} #${item.id}`
        ).join('\n');

        await sendButtons(sock, from, {
            title:   `🐦 TWITTER DOWNLOADER`,
            text:
                `⿻ *Tweet:* ${title.substring(0, 200)}\n\n` +
                `${itemList}\n\n` +
                `*Select media to download:*`,
            footer:  `Made by ${config.botName}`,
            buttons: getItemButtons(results, dateNow),
        }, { quoted: msg });

        await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });

        // ── Step 4: Item selection — persistent, multi-tap ────────────────────
        const handleItemSelect = async (event) => {
            const messageData = event.messages[0];
            if (!messageData?.message) return;

            const selectedId = extractButtonResponseId(messageData);
            if (!selectedId) return;
            if (!selectedId.includes('tw_item_') || !selectedId.includes(`_${dateNow}`)) return;
            if (messageData.key?.remoteJid !== from) return;

            const responseSender = getResponseSender(messageData);
            if (from.endsWith('@g.us') && responseSender !== originalSender) return;

            // ✅ No sock.ev.off — allows picking different items
            const match = selectedId.replace(prefix, '').match(/^tw_item_(\d+)_/);
            if (!match) return;
            const itemIndex = parseInt(match[1]);
            const item      = results[itemIndex];
            if (!item) return;

            const isVideo    = item.type === 'video';
            const fmtDateNow = Date.now();

            // ── Step 5: Send-as format buttons ────────────────────────────────
            await sendButtons(sock, from, {
                title:   `🐦 ${isVideo ? '🎬 VIDEO' : '🖼️ IMAGE'} — SEND AS`,
                text:
                    `⿻ *Type:*  ${isVideo ? '🎬 Video' : '🖼️ Image'}\n` +
                    `⿻ *Item:*  #${item.id}\n\n` +
                    `*Select how to receive:*`,
                footer:  `Made by ${config.botName}`,
                buttons: isVideo
                    ? getVideoFormatButtons(itemIndex, fmtDateNow)
                    : getImageFormatButtons(itemIndex, fmtDateNow),
            }, { quoted: messageData });

            await sock.sendMessage(from, { react: { text: '⬇️', key: msg.key } });

            // ── Step 6: Format selection — persistent, multi-tap ──────────────
            const handleFormatSelect = async (event) => {
                const fmtMsg = event.messages[0];
                if (!fmtMsg?.message) return;

                const fmtId = extractButtonResponseId(fmtMsg);
                if (!fmtId) return;
                if (!fmtId.includes(`_${itemIndex}_${fmtDateNow}`)) return;
                if (fmtMsg.key?.remoteJid !== from) return;

                const fmtSender = getResponseSender(fmtMsg);
                if (from.endsWith('@g.us') && fmtSender !== originalSender) return;

                // ✅ No sock.ev.off — multi-tap
                await sock.sendMessage(from, { react: { text: '⏬', key: msg.key } });

                try {
                    await downloadAndSend({
                        sock, from, msg: fmtMsg,
                        item, title, fmtId, prefix, dateNow: fmtDateNow,
                    });
                    await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });
                } catch (error) {
                    console.error('[twitter] download error:', error.message);
                    await sock.sendMessage(from, { react: { text: '❌', key: msg.key } });
                    await sock.sendMessage(from, {
                        text: `🚫 Error: ${error.message}\n\n_Try again later._`,
                    }, { quoted: fmtMsg });
                }
            };

            sock.ev.on('messages.upsert', handleFormatSelect);
            // ✅ No setTimeout — no expiry
        };

        sock.ev.on('messages.upsert', handleItemSelect);
        // ✅ No setTimeout — no expiry
    },
};

// ── Shared download + send helper ─────────────────────────────────────────────

async function downloadAndSend({ sock, from, msg, item, title, fmtId, prefix, dateNow }) {
    const isVideo  = item.type === 'video';

    // Parse format type from button ID
    // Video ID: tw_vfmt_<video|videodoc>_<index>_<dateNow>
    // Image ID: tw_ifmt_<image|imagedoc>_<index>_<dateNow>
    const parts      = fmtId.replace(prefix, '').split('_');
    const formatType = parts[2]; // video | videodoc | image | imagedoc

    const ext      = isVideo ? 'mp4' : 'jpg';
    const tempDir  = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
    const filePath = path.join(tempDir, `tw_${dateNow}.${ext}`);

    // Try direct URL first, fall back to proxy_link
    let downloadUrl = item.url;
    try {
        const stream = await axios({
            method: 'get', url: downloadUrl,
            responseType: 'stream', timeout: 600000,
        });
        const writer = fs.createWriteStream(filePath);
        stream.data.pipe(writer);
        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
    } catch {
        console.warn('[twitter] direct URL failed, trying proxy_link');
        downloadUrl = item.proxy_link;
        const stream = await axios({
            method: 'get', url: downloadUrl,
            responseType: 'stream', timeout: 600000,
        });
        const writer = fs.createWriteStream(filePath);
        stream.data.pipe(writer);
        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
        throw new Error('Download failed — file is empty');
    }

    const cleanTitle = (title || 'twitter_media').replace(/[^\w\s.-]/gi, '').substring(0, 80);

    if (formatType === 'video') {
        await sock.sendMessage(from, {
            video:    { url: filePath },
            mimetype: 'video/mp4',
            caption:  `🐦 ${title.substring(0, 200)}\n> ${config.botName}`,
        }, { quoted: msg });

    } else if (formatType === 'videodoc') {
        await sock.sendMessage(from, {
            document: { url: filePath },
            mimetype: 'video/mp4',
            fileName: `${cleanTitle}.mp4`,
            caption:  `🐦 ${title.substring(0, 200)}\n> ${config.botName}`,
        }, { quoted: msg });

    } else if (formatType === 'image') {
        await sock.sendMessage(from, {
            image:   { url: filePath },
            caption: `🐦 ${title.substring(0, 200)}\n> ${config.botName}`,
        }, { quoted: msg });

    } else if (formatType === 'imagedoc') {
        await sock.sendMessage(from, {
            document: { url: filePath },
            mimetype: 'image/jpeg',
            fileName: `${cleanTitle}.jpg`,
            caption:  `🐦 ${title.substring(0, 200)}\n> ${config.botName}`,
        }, { quoted: msg });
    }

    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}
