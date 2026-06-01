const { downloadMediaMessage } = require('@whiskeysockets/baileys');

// ─── resolve quoted message ───────────────────────────────────────────────
function resolveQuotedMsg(msg) {
    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    if (!ctx?.quotedMessage) return null;
    return {
        key: {
            remoteJid: msg.key.remoteJid,
            id: ctx.stanzaId,
            participant: ctx.participant,
        },
        message: ctx.quotedMessage,
    };
}

function getMediaType(msgObj) {
    const m = msgObj?.message || {};
    if (m.imageMessage)   return { type: 'image',   key: 'image' };
    if (m.videoMessage)   return { type: 'video',   key: 'video' };
    if (m.audioMessage)   return { type: 'audio',   key: 'audio' };
    if (m.documentMessage) return { type: 'document', key: 'document' };
    if (m.stickerMessage) return { type: 'sticker', key: 'sticker' };
    return null;
}

function toJid(input) {
    if (!input) return null;
    let s = String(input).trim().replace(/[^0-9]/g, '');
    if (!s) return null;
    return `${s}@s.whatsapp.net`;
}

module.exports = {
    name: 'forward',
    aliases: ['fwd', 'sendto'],
    category: 'general',
    description: 'Forward a message or quoted media to another number',
    usage: '.forward <number> [custom text] — reply to a message to forward it',

    async execute(sock, msg, args, extra) {
        try {
            const from = extra.from || msg.key.remoteJid;

            if (!args || args.length < 1) {
                return extra.reply(
                    `❌ *Usage:* .forward <number> [custom text]\n\n` +
                    `*Reply* to any message to forward it to the given number.\n\n` +
                    `Examples:\n` +
                    `• .forward 254712345678\n` +
                    `• .forward 254712345678 Hello check this out`
                );
            }

            const targetJid = toJid(args[0]);
            if (!targetJid) {
                return extra.reply('❌ Invalid phone number. Please provide a valid number.');
            }

            // Custom text from remaining args
            const customText = args.slice(1).join(' ').trim() || undefined;

            // Check if there's a quoted message
            const quoted = resolveQuotedMsg(msg);
            const mediaInfo = quoted ? getMediaType(quoted) : null;

            if (quoted && mediaInfo) {
                // ── Forward quoted media ───────────────────────────────────
                await extra.reply(`🔄`);

                let buffer;
                try {
                    buffer = await downloadMediaMessage(
                        quoted,
                        'buffer',
                        {},
                        { logger: undefined, reuploadRequest: sock.updateMediaMessage }
                    );
                } catch (e) {
                    return extra.reply(`❌ Failed to download media: ${e.message}`);
                }

                if (!buffer || buffer.length === 0) {
                    return extra.reply('❌ Media download returned empty buffer.');
                }

                const sendObj = {};
                sendObj[mediaInfo.key] = buffer;
                if (customText) {
                    sendObj.caption = customText;
                } else {
                    // Try to preserve original caption
                    const origCaption = quoted.message?.[mediaInfo.type + 'Message']?.caption;
                    if (origCaption) sendObj.caption = origCaption;
                }

                await sock.sendMessage(targetJid, sendObj);
                return extra.reply(`✅ Media forwarded to ${args[0]}.`);

            } else if (quoted) {
                // ── Forward quoted text ────────────────────────────────────
                const quotedText =
                    quoted.message?.extendedTextMessage?.text ||
                    quoted.message?.conversation ||
                    quoted.message?.[Object.keys(quoted.message)[0]]?.text ||
                    '';

                const textToSend = customText || quotedText || '';
                if (!textToSend) {
                    return extra.reply('❌ Could not extract text from the quoted message.');
                }

                await sock.sendMessage(targetJid, { text: textToSend });
                return extra.reply(`✅ Message forwarded to ${args[0]}.`);

            } else {
                // ── No quoted message — forward plain text if provided ────
                if (customText) {
                    await sock.sendMessage(targetJid, { text: customText });
                    return extra.reply(`✅ Message sent to ${args[0]}.`);
                }

                return extra.reply(
                    `❌ Please *reply* to a message to forward it, or provide text after the number.\n\n` +
                    `Usage: .forward <number> [text]`
                );
            }
        } catch (error) {
            try {
                await extra.reply(`❌ Forward failed: ${error.message || 'Unknown error'}`);
            } catch (_) {}
        }
    },
};
