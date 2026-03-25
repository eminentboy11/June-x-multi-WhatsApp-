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
        imageMessage:   { type: 'image', ext: '.jpg' },
        videoMessage:   { type: 'video', ext: '.mp4' },
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

module.exports = {
    name: 'tostatus',
    aliases: ['tst', 'tostory', 'poststatus'],
    category: 'owner',
    description: 'Post a private story to WhatsApp status (owner only)',
    usage: '.tostatus [text] or reply to an image/video with .tostatus [caption]',
    ownerOnly: true,

    async execute(sock, msg, args, extra) {
        try {
            const chatId = extra.from;
            const footer = `> Powered by ${config.botName}`;
            const caption = args.join(' ').trim();

            // ── Resolve media from quoted or direct attachment ─────────────────
            const quoted    = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage || null;
            const directMsg = msg.message;

            let media = null;
            if (quoted)     media = await extractMedia(quoted).catch(() => null);
            if (!media)     media = await extractMedia(directMsg).catch(() => null);

            // ── Show usage if nothing was provided ─────────────────────────────
            if (!media && !caption) {
                return extra.reply(
                    `📖 *tostatus — Post to WhatsApp Status*\n\n` +
                    `*Text story:*\n  ${config.prefix}tostatus Hello World!\n\n` +
                    `*Image/Video story:*\n  Reply to media with ${config.prefix}tostatus [caption]\n\n` +
                    `_Aliases: ${config.prefix}tst · ${config.prefix}tostory · ${config.prefix}poststatus_\n\n` +
                    `_Your story will be posted privately to your WhatsApp Status._`
                );
            }

            // ── Build the payload ──────────────────────────────────────────────
            let payload;
            let typeLabel;

            if (media) {
                const finalCaption = caption || media.caption;

                if (media.type === 'image') {
                    payload    = { image: media.buffer, caption: finalCaption };
                    typeLabel  = '🖼️ Image';
                } else if (media.type === 'video') {
                    payload    = { video: media.buffer, caption: finalCaption, gifPlayback: false };
                    typeLabel  = '🎬 Video';
                } else if (media.type === 'sticker') {
                    // Convert sticker to image status
                    payload    = { image: media.buffer, caption: finalCaption };
                    typeLabel  = '🎭 Sticker';
                } else {
                    return extra.reply('❌ Only images, videos, and stickers can be posted as a story.');
                }
            } else {
                payload   = { text: caption, backgroundColor: randomBg(), font: 0 };
                typeLabel = '📝 Text';
            }

            // ── Get contacts for private status (statusJidList) ────────────────
            let statusJidList = [];
            try {
                const contacts = sock.store?.contacts || {};
                statusJidList = Object.keys(contacts).filter(j => j.endsWith('@s.whatsapp.net'));
            } catch (_) {}

            // React to show it's working
            await sock.sendMessage(chatId, { react: { text: '⏳', key: msg.key } }).catch(() => {});

            // ── Post to status@broadcast ───────────────────────────────────────
            const sendOpts = statusJidList.length > 0 ? { statusJidList } : {};
            await sock.sendMessage(STATUS_JID, payload, sendOpts);

            // Success react
            await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } }).catch(() => {});

            // ── Confirmation with button ───────────────────────────────────────
            let confirmText =
                `✅ *Story Posted to Status!*\n\n` +
                `📋 *Type:* ${typeLabel}\n`;

            const displayCaption = caption || (media?.caption || '');
            if (displayCaption) {
                confirmText += `💬 *Caption:* ${displayCaption}\n`;
            }

            confirmText +=
                `👥 *Visibility:* Private (contacts only)\n` +
                `${statusJidList.length > 0 ? `📇 *Sent to:* ${statusJidList.length} contact(s)` : '📇 *Sent to:* All contacts'}`;

            await sendButtons(sock, chatId, {
                text: confirmText,
                footer,
                buttons: [
                    {
                        name: 'cta_url',
                        buttonParamsJson: JSON.stringify({
                            display_text: '📸 Open Status',
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
