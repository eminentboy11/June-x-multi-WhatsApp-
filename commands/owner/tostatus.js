const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { sendButtons } = require('gifted-btns');
const config = require('../../config');

const STATUS_JID = 'status@broadcast';

// Status background colours for text statuses (cycles randomly)
const BG_COLOURS = [
    '#000000', '#1a1a2e', '#16213e', '#0f3460',
    '#533483', '#6b2d8b', '#b5179e', '#d62828',
    '#e63946', '#2b9348', '#007f5f', '#023e8a'
];

function randomBg() {
    return BG_COLOURS[Math.floor(Math.random() * BG_COLOURS.length)];
}

async function extractMedia(content) {
    const map = {
        imageMessage:   { type: 'image',   ext: '.jpg'  },
        videoMessage:   { type: 'video',   ext: '.mp4'  },
        stickerMessage: { type: 'sticker', ext: '.webp' },
    };
    for (const [key, { type, ext }] of Object.entries(map)) {
        if (!content[key]) continue;
        try {
            const stream = await downloadContentFromMessage(content[key], type);
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            return {
                buffer:  Buffer.concat(chunks),
                type,
                ext,
                mime:    content[key].mimetype || '',
                caption: content[key].caption  || ''
            };
        } catch (_) {}
    }
    return null;
}

/**
 * Build statusJidList from the bot's message store.
 * Falls back to owner numbers if the store is empty.
 */
function getStatusJidList(sock) {
    const jids = new Set();

    // Primary: extract individual-chat JIDs from bot store message keys
    try {
        const messages = sock.botStore?.messages;
        if (messages instanceof Map) {
            for (const jid of messages.keys()) {
                if (jid && jid.endsWith('@s.whatsapp.net')) jids.add(jid);
            }
        }
    } catch (_) {}

    // Fallback: include owner numbers so at least they can see the status
    if (jids.size === 0) {
        const owners = [].concat(config.ownerNumber || []);
        for (const num of owners) {
            const clean = String(num).replace(/\D/g, '');
            if (clean) jids.add(`${clean}@s.whatsapp.net`);
        }
    }

    return [...jids];
}

module.exports = {
    name: 'tostatus',
    aliases: ['tst', 'tostory', 'poststatus'],
    category: 'owner',
    description: 'Post a private story to WhatsApp status (owner only)',
    usage: '.tostatus [text]  OR  reply to image/video with .tostatus [caption]',
    ownerOnly: true,

    async execute(sock, msg, args, extra) {
        try {
            const chatId = extra.from;
            const footer = `> Powered by ${config.botName}`;
            const caption = args.join(' ').trim();

            // ── Resolve media from quoted message or direct attachment ──────────
            const quoted    = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage || null;
            const directMsg = msg.message;

            let media = null;
            if (quoted)  media = await extractMedia(quoted).catch(() => null);
            if (!media)  media = await extractMedia(directMsg).catch(() => null);

            // ── Show usage if nothing was provided ─────────────────────────────
            if (!media && !caption) {
                return extra.reply(
                    `📖 *tostatus — Post to WhatsApp Status*\n\n` +
                    `*Text story:*\n  ${config.prefix}tostatus Hello World!\n\n` +
                    `*Image/Video story:*\n  Reply to media with ${config.prefix}tostatus [caption]\n\n` +
                    `_Aliases: ${config.prefix}tst · ${config.prefix}tostory · ${config.prefix}poststatus_`
                );
            }

            // ── Build the status payload ───────────────────────────────────────
            let payload;
            let typeLabel;

            if (media) {
                const finalCaption = caption || media.caption;
                if (media.type === 'image' || media.type === 'sticker') {
                    payload   = { image: media.buffer, caption: finalCaption };
                    typeLabel = media.type === 'sticker' ? '🎭 Sticker' : '🖼️ Image';
                } else if (media.type === 'video') {
                    payload   = { video: media.buffer, caption: finalCaption, gifPlayback: false };
                    typeLabel = '🎬 Video';
                } else {
                    return extra.reply('❌ Only images, videos, and stickers can be posted as a story.');
                }
            } else {
                payload   = { text: caption, backgroundColor: randomBg(), font: 0 };
                typeLabel = '📝 Text';
            }

            // ── Build statusJidList — required by Baileys to deliver the status ─
            const statusJidList = getStatusJidList(sock);

            if (statusJidList.length === 0) {
                return extra.reply('❌ No contacts found to post the status to. Send the bot a message first so it can build its contact list.');
            }

            // React to show progress
            await sock.sendMessage(chatId, { react: { text: '⏳', key: msg.key } }).catch(() => {});

            // ── Post to status@broadcast ───────────────────────────────────────
            await sock.sendMessage(STATUS_JID, payload, { statusJidList });

            // Success react
            await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } }).catch(() => {});

            // ── Confirmation message with button ───────────────────────────────
            let confirmText =
                `✅ *Story Posted to Status!*\n\n` +
                `📋 *Type:* ${typeLabel}\n`;

            const displayCaption = caption || media?.caption || '';
            if (displayCaption) confirmText += `💬 *Caption:* ${displayCaption}\n`;

            confirmText += `📇 *Delivered to:* ${statusJidList.length} contact(s)`;

            await sendButtons(sock, chatId, {
                text: confirmText,
                footer,
                buttons: [
                    {
                        name: 'cta_url',
                        buttonParamsJson: JSON.stringify({
                            display_text: '📸 Open WhatsApp',
                            url: 'https://wa.me'
                        })
                    }
                ]
            }, { quoted: msg });

        } catch (error) {
            console.error('[tostatus] error:', error);
            await sock.sendMessage(extra.from, { react: { text: '❌', key: msg.key } }).catch(() => {});
            await extra.reply(`❌ Failed to post story:\n${error.message}`);
        }
    }
};
