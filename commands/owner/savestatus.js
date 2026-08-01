const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { sendButtons } = require('gifted-btns');
const config = require('../../config');
const fs   = require('fs');
const path = require('path');

// Any-emoji pattern — matches a reply that contains only emoji characters (no plain text/digits)
const HAPPY_EMOJI_RE = /^\s*[\p{Extended_Pictographic}\u200d\ufe0f\u20e3\s]+\s*$/u;

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
        return sock.sendMessage(chatId, { text: '❌ Could not download status. It may have expired.' }, { quoted: quotedMsg }).catch(() => {});
    }

    if (media.type === 'text') {
        await sendButtons(sock, chatId, {
            text: `💾 *Status Saved!*\n\n📝 *Text:*\n${media.text}`,
            footer,
            buttons: [{
                name: 'cta_copy',
                buttonParamsJson: JSON.stringify({ display_text: '📋 Copy Text', copy_code: media.text })
            }]
        }, { quoted: quotedMsg }).catch(() => {});
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

// Sends the "who/what" header + the saved status content, both to selfJid only
async function forwardToSelf(sock, selfJid, media, senderJid, msg, triggerLabel) {
    if (!selfJid) return;

    try {
        const senderNum  = senderJid.split('@')[0];
        const pushname   = msg?.pushName || `+${senderNum}`;
        const mediaLabel = media
            ? (media.type === 'text' ? '📝 Text status' : `📎 ${media.type.charAt(0).toUpperCase() + media.type.slice(1)} status`)
            : '❓ Unknown';

        await sock.sendMessage(selfJid, {
            text:
                `👁️ *Status Reaction Received*\n\n` +
                `👤 *From:* ${pushname} (+${senderNum})\n` +
                `${triggerLabel}\n` +
                `📦 *Content:* ${mediaLabel}\n\n` +
                `_Forwarding status to your chat..._`
        });

        await sendSavedStatus(sock, selfJid, media, null);
    } catch (_) {}
}

// ── Exported auto-handler — called from index.js for every private message ────
async function handleStatusReply(sock, msg) {
    try {
        const from = msg.key.remoteJid || '';
        // Only handle private chats
        if (!from.endsWith('@s.whatsapp.net')) return false;

        // Support both text replies and sticker replies to statuses
        const isStickerReply = !!msg.message?.stickerMessage;
        const ctx =
            msg.message?.extendedTextMessage?.contextInfo ||
            msg.message?.stickerMessage?.contextInfo;

        // Must be a reply to a status@broadcast message
        if (!ctx || ctx.remoteJid !== 'status@broadcast') return false;

        const text =
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text || '';

        // Sticker replies always trigger; text replies must match a save trigger
        if (!isStickerReply && !isSaveTrigger(text)) return false;

        const quotedMsg = ctx.quotedMessage;
        if (!quotedMsg) return false;

        await sock.sendMessage(from, { react: { text: '💾', key: msg.key } }).catch(() => {});

        const media = await downloadStatus(quotedMsg);

        // ── Only send the saved status to the bot's own chat — never back to sender ──
        const selfJid = getBotSelfJid(sock);
        if (selfJid) {
            const triggerLabel = isStickerReply
                ? `🎭 *Trigger:* Sticker`
                : `💌 *Trigger:* ${text.trim()}`;
            await forwardToSelf(sock, selfJid, media, from, msg, triggerLabel);
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
    description: 'Save a WhatsApp status by replying to it — saved copy goes to your own chat only',
    usage: '.savestatus — reply to a forwarded status message',
    ownerOnly: false,

    isSaveTrigger,
    handleStatusReply,

    async execute(sock, msg, args, extra) {
        try {
            const chatId = extra.from;

            // ctx covers both manual text replies and sticker replies
            const ctx =
                msg.message?.extendedTextMessage?.contextInfo ||
                msg.message?.stickerMessage?.contextInfo;
            const quotedMsg = ctx?.quotedMessage;

            if (!quotedMsg) {
                if (extra.forwardToSelf) return;
                return extra.reply(
                    `💾 *Save Status*\n\n` +
                    `Reply to a status message with:\n` +
                    `  *${config.prefix}save* — manual save\n` +
                    `  _Or just reply with:_ save · send · hello · hey · 😊\n\n` +
                    `_Saved copy is sent to your own chat only._`
                );
            }

            await sock.sendMessage(chatId, { react: { text: '💾', key: msg.key } }).catch(() => {});

            const media = await downloadStatus(quotedMsg);

            // ── Only ever deliver to bot's self chat ──
            const selfJid = getBotSelfJid(sock);
            const triggerLabel = extra.triggerLabel || `💾 *Trigger:* Manual save`;
            await forwardToSelf(sock, selfJid, media, chatId, msg, triggerLabel);

        } catch (error) {
            await extra.reply(`❌ Failed to save status:\n${error.message}`);
        }
    }
};
