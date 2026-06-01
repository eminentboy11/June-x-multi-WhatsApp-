const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const config = require('../../config');

// ─── Detect if the replied message is a status ───────────────────────────────────
function isStatusReply(msg) {
    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    return ctx && ctx.remoteJid === 'status@broadcast';
}

// ─── Download status media from the quoted message ───────────────────────
async function downloadStatusMedia(quotedMsg) {
    const content = quotedMsg;

    const mediaMap = {
        imageMessage:    'image',
        videoMessage:    'video',
        audioMessage:    'audio',
        stickerMessage:  'sticker',
        documentMessage: 'document',
    };

    for (const [key, type] of Object.entries(mediaMap)) {
        if (!content[key]) continue;
        try {
            const stream = await downloadContentFromMessage(content[key], type);
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            return {
                buffer: Buffer.concat(chunks),
                type,
                mime:   content[key].mimetype || '',
                caption: content[key].caption || '',
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

            // Re-share to status@broadcast
            if (media.type === 'text') {
                const textToShare = customText || media.text || '';
                if (!textToShare) {
                    return extra.reply('❌ No text found to re-share.');
                }
                await sock.sendMessage('status@broadcast', { text: textToShare });
                return extra.reply('✅ Text status re-shared successfully.');

            } else if (media.type === 'image') {
                const caption = customText || media.caption || '';
                await sock.sendMessage('status@broadcast', {
                    image: media.buffer,
                    caption: caption || undefined,
                });
                return extra.reply('✅ Image status re-shared successfully.');

            } else if (media.type === 'video') {
                const caption = customText || media.caption || '';
                await sock.sendMessage('status@broadcast', {
                    video: media.buffer,
                    caption: caption || undefined,
                    gifPlayback: false,
                });
                return extra.reply('✅ Video status re-shared successfully.');

            } else if (media.type === 'audio') {
                await sock.sendMessage('status@broadcast', {
                    audio: media.buffer,
                    mimetype: media.mime || 'audio/mp4',
                    ptt: false,
                });
                return extra.reply('✅ Audio status re-shared successfully.');

            } else if (media.type === 'sticker') {
                await sock.sendMessage('status@broadcast', { sticker: media.buffer });
                return extra.reply('✅ Sticker status re-shared successfully.');

            } else {
                await sock.sendMessage('status@broadcast', {
                    document: media.buffer,
                    mimetype: media.mime || 'application/octet-stream',
                    fileName: 'reshared_status',
                    caption: customText || '',
                });
                return extra.reply('✅ Status re-shared successfully.');
            }

        } catch (error) {
            try {
                await extra.reply(`❌ Re-share failed: ${error.message || 'Unknown error'}`);
            } catch (_) {}
        }
    },
};
