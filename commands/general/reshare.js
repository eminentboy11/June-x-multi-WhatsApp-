const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const config = require('../../config');

const STATUS_JID = 'status@broadcast';

// ─── Detect if the replied message is a status ─────────────────────────────
function isStatusReply(msg) {
    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    return ctx && ctx.remoteJid === STATUS_JID;
}

// ─── Build statusJidList: owner + known contacts from bot store ─────────────
function getStatusJidList(sock) {
    const jids = new Set();

    // Always include owner numbers
    const owners = [].concat(config.ownerNumber || []);
    for (const num of owners) {
        const clean = String(num).replace(/\D/g, '');
        if (clean) jids.add(`${clean}@s.whatsapp.net`);
    }

    // Also add any individual contacts from the bot's message store
    try {
        const messages = sock.botStore?.messages;
        if (messages instanceof Map) {
            for (const jid of messages.keys()) {
                if (jid && jid.endsWith('@s.whatsapp.net')) jids.add(jid);
            }
        }
    } catch (_) {}

    return [...jids];
}

// ─── Download status media from the quoted message ───────────────────────
async function downloadStatusMedia(quotedMsg) {
    const content = quotedMsg;

    const mediaMap = {
        imageMessage:    { type: 'image',   ext: '.jpg' },
        videoMessage:    { type: 'video',   ext: '.mp4' },
        audioMessage:    { type: 'audio',   ext: '.mp3' },
        stickerMessage:  { type: 'sticker', ext: '.webp' },
        documentMessage: { type: 'document', ext: '.bin' },
    };

    for (const [key, { type, ext }] of Object.entries(mediaMap)) {
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
                caption: content[key].caption  || '',
            };
        } catch (_) {}
    }

    // Text-only status
    const text =
        content.conversation ||
        content.extendedTextMessage?.text ||
        content.ephemeralMessage?.message?.conversation || '';

    if (text) return { type: 'text', text };
    return null;
}

module.exports = {
    name: 'reshare',
    aliases: ['rs', 'repost', 'status'],
    category: 'general',
    description: 'Re-share a WhatsApp status you replied to as your own status',
    usage: '.reshare [custom text] — reply to a status to re-share it',

    async execute(sock, msg, args, extra) {
        try {
            const chatId = extra.from || msg.key.remoteJid;
            const ctx = msg.message?.extendedTextMessage?.contextInfo;
            const quotedMsg = ctx?.quotedMessage;

            if (!quotedMsg) {
                return extra.reply(
                    `❌ *Usage:* .reshare [custom text]\n\n` +
                    `*Reply* to a status message to re-share it as your own status.\n\n` +
                    `Examples:\n` +
                    `• .reshare (reply to a status)\n` +
                    `• .reshare hello (reply to a status with custom caption)\n\n` +
                    `_Supports: images, videos, audio, text statuses_`
                );
            }

            if (!isStatusReply(msg)) {
                return extra.reply(
                    `❌ The replied message is not a *status* update.\n\n` +
                    `Please reply to a WhatsApp status to re-share it.`
                );
            }

            await sock.sendMessage(chatId, { react: { text: '🔄', key: msg.key } }).catch(() => {});

            const media = await downloadStatusMedia(quotedMsg);
            if (!media) {
                return extra.reply('❌ Could not download the status. It may have expired.');
            }

            const customText = args.join(' ').trim() || undefined;

            // Build statusJidList so the status is visible
            const statusJidList = getStatusJidList(sock);

            // Re-share to status@broadcast
            if (media.type === 'text') {
                const textToShare = customText || media.text || '';
                if (!textToShare) {
                    return extra.reply('❌ No text found to re-share.');
                }
                await sock.sendMessage(STATUS_JID, { text: textToShare, backgroundColor: '#000000', font: 2 }, { statusJidList });
                return extra.reply('✅ Text status re-shared successfully.');

            } else if (media.type === 'image') {
                const caption = customText || media.caption || '';
                await sock.sendMessage(STATUS_JID, {
                    image:    media.buffer,
                    mimetype: media.mime || 'image/jpeg',
                    caption:  caption || undefined,
                }, { statusJidList });
                return extra.reply('✅ Image status re-shared successfully.');

            } else if (media.type === 'video') {
                const caption = customText || media.caption || '';
                await sock.sendMessage(STATUS_JID, {
                    video:       media.buffer,
                    mimetype:    media.mime || 'video/mp4',
                    caption:     caption || undefined,
                    gifPlayback: false,
                }, { statusJidList });
                return extra.reply('✅ Video status re-shared successfully.');

            } else if (media.type === 'audio') {
                await sock.sendMessage(STATUS_JID, {
                    audio:    media.buffer,
                    mimetype: media.mime || 'audio/mp4',
                    ptt:      false,
                }, { statusJidList });
                return extra.reply('✅ Audio status re-shared successfully.');

            } else if (media.type === 'sticker') {
                await sock.sendMessage(STATUS_JID, { sticker: media.buffer }, { statusJidList });
                return extra.reply('✅ Sticker status re-shared successfully.');

            } else {
                await sock.sendMessage(STATUS_JID, {
                    document: media.buffer,
                    mimetype: media.mime || 'application/octet-stream',
                    fileName: 'reshared_status',
                    caption:  customText || '',
                }, { statusJidList });
                return extra.reply('✅ Status re-shared successfully.');
            }

        } catch (error) {
            try {
                await extra.reply(`❌ Re-share failed: ${error.message || 'Unknown error'}`);
            } catch (_) {}
        }
    },
};
