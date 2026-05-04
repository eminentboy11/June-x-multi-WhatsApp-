/**
 * tostatus — Post a story directly to WhatsApp status@broadcast.
 * Supports: text, image, video.
 * Owner only.
 */

const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const config = require(require('path').join(global.__ROOT__, 'config'));

const STATUS_JID = 'status@broadcast';

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
        imageMessage: { type: 'image', ext: '.jpg' },
        videoMessage: { type: 'video', ext: '.mp4' },
    };
    for (const [key, { type }] of Object.entries(map)) {
        if (!content[key]) continue;
        try {
            const stream = await downloadContentFromMessage(content[key], type);
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            return {
                buffer:  Buffer.concat(chunks),
                type,
                mime:    content[key].mimetype || (type === 'image' ? 'image/jpeg' : 'video/mp4'),
                caption: content[key].caption  || ''
            };
        } catch (_) {}
    }
    return null;
}

/** Build a minimal statusJidList from owner numbers */
function getStatusJidList() {
    const jids = new Set();
    const owners = [].concat(config.ownerNumber || []);
    for (const num of owners) {
        const clean = String(num).replace(/\D/g, '');
        if (clean) jids.add(`${clean}@s.whatsapp.net`);
    }
    return [...jids];
}

module.exports = {
    name: 'tostatus',
    aliases: ['tst', 'tostory', 'poststatus'],
    category: 'owner',
    description: 'Post a story to WhatsApp status (owner only)',
    usage: '.tostatus [text]  OR  reply to image/video with .tostatus [caption]',
    ownerOnly: true,

    async execute(sock, msg, args, extra) {
        const { from, reply } = extra;
        try {
            const caption = args.join(' ').trim();

            // Resolve media: quoted first, then direct attachment
            const quoted    = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage || null;
            const directMsg = msg.message;

            let media = null;
            if (quoted)   media = await extractMedia(quoted).catch(() => null);
            if (!media)   media = await extractMedia(directMsg).catch(() => null);

            // Show usage if nothing was provided
            if (!media && !caption) {
                return reply(
                    `📖 *tostatus — Post to WhatsApp Status*\n\n` +
                    `*Text story:*\n  ${config.prefix}tostatus Hello World!\n\n` +
                    `*Image story:*\n  Reply to an image with ${config.prefix}tostatus [caption]\n\n` +
                    `*Video story:*\n  Reply to a video with ${config.prefix}tostatus [caption]\n\n` +
                    `_Aliases: ${config.prefix}tst · ${config.prefix}tostory · ${config.prefix}poststatus_`
                );
            }

            // Build payload
            let payload;
            let typeLabel;

            if (media) {
                const finalCaption = caption || media.caption || '';
                if (media.type === 'image') {
                    payload   = { image: media.buffer, mimetype: media.mime || 'image/jpeg', caption: finalCaption };
                    typeLabel = '🖼️ Image';
                } else if (media.type === 'video') {
                    payload   = { video: media.buffer, mimetype: media.mime || 'video/mp4', caption: finalCaption, gifPlayback: false };
                    typeLabel = '🎬 Video';
                } else {
                    return reply('❌ Only images and videos can be posted as a story.');
                }
            } else {
                payload   = { text: caption, backgroundColor: randomBg(), font: 2 };
                typeLabel = '📝 Text';
            }

            const statusJidList = getStatusJidList();

            await sock.sendMessage(from, { react: { text: '⏳', key: msg.key } }).catch(() => {});

            // Post directly to status@broadcast
            await sock.sendMessage(STATUS_JID, payload, { statusJidList });

            await sock.sendMessage(from, { react: { text: '✅', key: msg.key } }).catch(() => {});

            const displayCaption = caption || media?.caption || '';
            await reply(
                `✅ *Status Posted!*\n` +
                `━━━━━━━━━━━━━━━\n` +
                `📋 *Type:* ${typeLabel}\n` +
                (displayCaption ? `💬 *Caption:* ${displayCaption}\n` : '') +
                `📇 *Audience:* ${statusJidList.length} contact(s)`
            );

        } catch (error) {
            console.error('[tostatus] error:', error);
            await sock.sendMessage(from, { react: { text: '❌', key: msg.key } }).catch(() => {});
            await reply(`❌ Failed to post status:\n${error.message}`);
        }
    }
};
