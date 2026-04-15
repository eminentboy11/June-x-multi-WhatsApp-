const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { sendButtons } = require('gifted-btns');
const config = require('../../config');
const fs   = require('fs');
const path = require('path');

// Happy-emoji-only pattern (emoji replies → also forward to bot self-chat)
const HAPPY_EMOJI_RE = /^[\s😀😁😂🤣😃😄😅😆😉😊😋😎😍🥰😘😗😙😚🙂🤗🤩🥳😇🤠🎉🎊❤️💕💖💗💓💞💝💘💟🫶👍🙏✨🌟⭐💫🔥👏🎶🎵😸😺]+$/u;

// All patterns that trigger auto-save when replying to a status
const SAVE_TRIGGERS = [
    /^\s*(save|send)\s*$/i,
    /^\s*(hello|hey|hi)\s*$/i,
    HAPPY_EMOJI_RE,
];

function isSaveTrigger(text) {
    if (!text || !text.trim()) return false;
    return SAVE_TRIGGERS.some(re => re.test(text.trim()));
}

function isHappyEmoji(text) {
    if (!text || !text.trim()) return false;
    return HAPPY_EMOJI_RE.test(text.trim());
}

// Get bot's own normalised JID from sock.user.id (strips :xx device suffix)
function getBotSelfJid(sock) {
    const raw = sock?.user?.id;
    if (!raw) return null;
    const user = raw.split(':')[0].split('@')[0];
    return `${user}@s.whatsapp.net`;
}

async function downloadStatus(statusMsg) {
    const content = statusMsg;

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
                buffer:  Buffer.concat(chunks),
                type,
                mime:    content[key].mimetype || '',
                caption: content[key].caption  || '',
                ext: { image: '.jpg', video: '.mp4', audio: '.mp3', sticker: '.webp', document: '.bin' }[type] || '.bin',
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

async function sendSavedStatus(sock, chatId, media, quotedMsg) {
    const footer = `> Powered by ${config.botName}`;

    if (!media) {
        return sock.sendMessage(chatId, { text: '❌ Could not download status. It may have expired.' }, { quoted: quotedMsg });
    }

    if (media.type === 'text') {
        await sendButtons(sock, chatId, {
            text: `💾 *Status Saved!*\n\n📝 *Text:*\n${media.text}`,
            footer,
            buttons: [{
                name: 'cta_copy',
                buttonParamsJson: JSON.stringify({ display_text: '📋 Copy Text', copy_code: media.text })
            }]
        }, { quoted: quotedMsg });
        return;
    }

    const caption = media.caption
        ? `💾 *Status Saved!*\n\n💬 ${media.caption}`
        : `💾 *Status Saved!*`;

    if (media.type === 'image') {
        await sock.sendMessage(chatId, { image: media.buffer, caption }, { quoted: quotedMsg });
    } else if (media.type === 'video') {
        await sock.sendMessage(chatId, { video: media.buffer, caption, gifPlayback: false }, { quoted: quotedMsg });
    } else if (media.type === 'audio') {
        await sock.sendMessage(chatId, { audio: media.buffer, mimetype: media.mime || 'audio/mp4', ptt: false }, { quoted: quotedMsg });
    } else if (media.type === 'sticker') {
        await sock.sendMessage(chatId, { sticker: media.buffer }, { quoted: quotedMsg });
    } else {
        await sock.sendMessage(chatId, {
            document: media.buffer,
            mimetype: media.mime || 'application/octet-stream',
            fileName: `status${media.ext}`,
            caption
        }, { quoted: quotedMsg });
    }
}

// ── Exported auto-handler — called from index.js for every private message ────
async function handleStatusReply(sock, msg) {
    try {
        const from = msg.key.remoteJid || '';
        // Only handle private chats
        if (!from.endsWith('@s.whatsapp.net')) return false;

        const ctx = msg.message?.extendedTextMessage?.contextInfo;
        // Must be a reply to a status@broadcast message
        if (!ctx || ctx.remoteJid !== 'status@broadcast') return false;

        const text =
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text || '';

        if (!isSaveTrigger(text)) return false;

        const quotedMsg = ctx.quotedMessage;
        if (!quotedMsg) return false;

        await sock.sendMessage(from, { react: { text: '💾', key: msg.key } }).catch(() => {});

        const media = await downloadStatus(quotedMsg);

        // ── Send status back to the sender ────────────────────────────────────
        await sendSavedStatus(sock, from, media, msg);

        // ── If trigger was a happy emoji, also forward to bot's self-chat ─────
        if (isHappyEmoji(text)) {
            const selfJid = getBotSelfJid(sock);
            if (selfJid && from !== selfJid) {
                try {
                    const senderNum  = from.split('@')[0];
                    const pushname   = msg.pushName || `+${senderNum}`;
                    const mediaLabel = media
                        ? (media.type === 'text' ? '📝 Text status' : `📎 ${media.type.charAt(0).toUpperCase() + media.type.slice(1)} status`)
                        : '❓ Unknown';

                    // Notification header
                    await sock.sendMessage(selfJid, {
                        text:
                            `👁️ *Status Reaction Received*\n\n` +
                            `👤 *From:* ${pushname} (+${senderNum})\n` +
                            `💌 *Emoji:* ${text.trim()}\n` +
                            `📦 *Content:* ${mediaLabel}\n\n` +
                            `_Forwarding status to your chat..._`
                    });

                    // Forward the actual status content
                    await sendSavedStatus(sock, selfJid, media, null);
                } catch (_) {}
            }
        }

        return true;
    } catch (_) {
        return false;
    }
}

// ── Manual command: reply to any status/media in chat with +save ───────────────
module.exports = {
    name: 'savestatus',
    aliases: ['save', 'savest', 'dlstatus'],
    category: 'owner',
    description: 'Save a WhatsApp status by replying to it (or auto-triggered by save/hey/emoji replies)',
    usage: '.savestatus — reply to a forwarded status message',
    ownerOnly: false,

    isSaveTrigger,
    handleStatusReply,

    async execute(sock, msg, args, extra) {
        try {
            const chatId = extra.from;
            const ctx = msg.message?.extendedTextMessage?.contextInfo;
            const quotedMsg = ctx?.quotedMessage;

            if (!quotedMsg) {
                return extra.reply(
                    `💾 *Save Status*\n\n` +
                    `Reply to a status message with:\n` +
                    `  *${config.prefix}save* — manual save\n` +
                    `  _Or just reply with:_ save · send · hello · hey · 😊\n\n` +
                    `_Supports: images, videos, audio, stickers, text statuses_`
                );
            }

            await sock.sendMessage(chatId, { react: { text: '💾', key: msg.key } }).catch(() => {});

            const media = await downloadStatus(quotedMsg);
            await sendSavedStatus(sock, chatId, media, msg);

        } catch (error) {
            await extra.reply(`❌ Failed to save status:\n${error.message}`);
        }
    }
};
