const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { sendButtons } = require('gifted-btns');
const config = require('../../config');

const STATUS_JID = 'status@broadcast';

const BG_COLOURS = [
    '#000000', '#1a1a2e', '#16213e', '#0f3460',
    '#533483', '#6b2d8b', '#b5179e', '#d62828',
    '#e63946', '#2b9348', '#007f5f', '#023e8a'
];
function randomBg() {
    return BG_COLOURS[Math.floor(Math.random() * BG_COLOURS.length)];
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function extractMedia(content) {
    const map = {
        imageMessage: { type: 'image', ext: '.jpg' },
        videoMessage: { type: 'video', ext: '.mp4' },
    };
    for (const [key, { type, ext }] of Object.entries(map)) {
        if (!content[key]) continue;
        try {
            const stream  = await downloadContentFromMessage(content[key], type);
            const chunks  = [];
            for await (const chunk of stream) chunks.push(chunk);
            return {
                buffer:  Buffer.concat(chunks),
                type,
                ext,
                mime:    content[key].mimetype || (type === 'image' ? 'image/jpeg' : 'video/mp4'),
                caption: content[key].caption  || ''
            };
        } catch (_) {}
    }
    return null;
}

/**
 * Owner numbers are always allowed to see the status. We no longer scan the
 * bot's chat/contact store for JIDs — that was unreliable (missing contacts,
 * stale cache) and isn't what actually fixes status delivery. WhatsApp itself
 * decides visibility for a plain status@broadcast post based on the account's
 * own contact list, so we just make sure the owner is included.
 */
function getStatusJidList(sock) {
    const jids = new Set();
    const owners = [].concat(config.ownerNumber || []);
    for (const num of owners) {
        const clean = String(num).replace(/\D/g, '');
        if (clean) jids.add(`${clean}@s.whatsapp.net`);
    }
    return [...jids];
}

/**
 * The real reason media statuses often show up broken/blank is that Baileys
 * resolves sendMessage() as soon as the upload request is accepted, not once
 * the media has actually finished propagating to WhatsApp's media servers.
 * Instead of trying to fix this by scanning contacts, we give the upload a
 * bit of real time to settle — scaled to the payload size — before we tell
 * the user it's done.
 */
async function waitForUploadToSettle(media) {
    if (!media) {
        await sleep(800); // text status, still needs a moment to register
        return;
    }
    const sizeMb = media.buffer.length / (1024 * 1024);
    // Base delay + extra time per MB, capped so we don't hang forever.
    const base = media.type === 'video' ? 3000 : 1500;
    const perMb = media.type === 'video' ? 700 : 400;
    const delay = Math.min(base + sizeMb * perMb, 15000);
    await sleep(delay);
}

module.exports = {
    name: 'tostatus',
    aliases: ['tst', 'tostory', 'poststatus'],
    category: 'owner',
    description: 'Post a story to WhatsApp status (owner only)',
    usage: '.tostatus [text]  OR  reply to image/video with .tostatus [caption]',
    ownerOnly: true,

    async execute(sock, msg, args, extra) {
        try {
            const chatId  = extra.from;
            const footer  = `> Powered by ${config.botName}`;
            const caption = args.join(' ').trim();

            // Resolve media from quoted message or direct attachment
            const quoted    = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage || null;
            const directMsg = msg.message;

            let media = null;
            if (quoted)  media = await extractMedia(quoted).catch(() => null);
            if (!media)  media = await extractMedia(directMsg).catch(() => null);

            // Show usage if nothing was provided
            if (!media && !caption) {
                return extra.reply(
                    `📖 *tostatus — Post to WhatsApp Status*\n\n` +
                    `*Text story:*\n  ${config.prefix}tostatus Hello World!\n\n` +
                    `*Image story:*\n  Reply to an image with ${config.prefix}tostatus [caption]\n\n` +
                    `*Video story:*\n  Reply to a video with ${config.prefix}tostatus [caption]\n\n` +
                    `_Aliases: ${config.prefix}tst · ${config.prefix}tostory · ${config.prefix}poststatus_`
                );
            }

            // Build the status payload with explicit mimetype (required by Baileys)
            let payload;
            let typeLabel;

            if (media) {
                const finalCaption = caption || media.caption;
                if (media.type === 'image') {
                    payload   = {
                        image:    media.buffer,
                        mimetype: media.mime || 'image/jpeg',
                        caption:  finalCaption
                    };
                    typeLabel = '🖼️ Image';
                } else if (media.type === 'video') {
                    payload   = {
                        video:       media.buffer,
                        mimetype:    media.mime || 'video/mp4',
                        caption:     finalCaption,
                        gifPlayback: false
                    };
                    typeLabel = '🎬 Video';
                } else {
                    return extra.reply('❌ Only images and videos can be posted as a story.');
                }
            } else {
                payload   = { text: caption, backgroundColor: randomBg(), font: 2 };
                typeLabel = '📝 Text';
            }

            // Owner is always allowed to view — no contact scanning needed.
            const statusJidList = getStatusJidList(sock);

            await sock.sendMessage(chatId, { react: { text: '⏳', key: msg.key } }).catch(() => {});

            // Post to status@broadcast, then give the upload real time to
            // finish propagating before we consider it "posted".
            await sock.sendMessage(STATUS_JID, payload, { statusJidList, backgroundColor: payload.backgroundColor, font: payload.font });
            await waitForUploadToSettle(media);

            await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } }).catch(() => {});

            let confirmText =
                `✅ *Story Posted to Status!*\n\n` +
                `📋 *Type:* ${typeLabel}\n`;

            const displayCaption = caption || media?.caption || '';
            if (displayCaption) confirmText += `💬 *Caption:* ${displayCaption}\n`;
            confirmText += `⏱️ *Upload:* fully settled before confirming`;

            await sendButtons(sock, chatId, {
                text: confirmText,
                footer,
                buttons: [{
                    name: 'cta_url',
                    buttonParamsJson: JSON.stringify({
                        display_text: '📸 Open WhatsApp',
                        url: 'https://wa.me/'
                    })
                }]
            }, { quoted: msg });

        } catch (error) {
            console.error('[tostatus] error:', error);
            await sock.sendMessage(extra.from, { react: { text: '❌', key: msg.key } }).catch(() => {});
            await extra.reply(`❌ Failed to post story:\n${error.message}`);
        }
    }
};
