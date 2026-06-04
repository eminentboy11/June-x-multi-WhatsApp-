/**
 * Group Status Command — Post text or replied media as a WhatsApp Group Status.
 * Supports: text, image, video, audio (opus), document, sticker.
 */

const crypto = require('crypto');
const {
    generateWAMessageContent,
    generateWAMessageFromContent,
    downloadContentFromMessage,
} = require('@whiskeysockets/baileys');
const { PassThrough } = require('stream');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
ffmpeg.setFfmpegPath(ffmpegPath);

const PURPLE_COLOR = '#9C27B0';

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function downloadMedia(msg, type) {
    const mediaMsg = msg[`${type}Message`] || msg;
    const stream = await downloadContentFromMessage(mediaMsg, type);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
}

async function groupStatus(sock, jid, content) {
    const { backgroundColor } = content;
    delete content.backgroundColor;

    const inside = await generateWAMessageContent(content, {
        upload: sock.waUploadToServer,
        backgroundColor: backgroundColor || PURPLE_COLOR,
    });

    const secret = crypto.randomBytes(32);

    const msg = generateWAMessageFromContent(
        jid,
        {
            messageContextInfo: { messageSecret: secret },
            groupStatusMessageV2: {
                message: {
                    ...inside,
                    messageContextInfo: { messageSecret: secret },
                },
            },
        },
        {},
    );

    await sock.relayMessage(jid, msg.message, { messageId: msg.key.id });
    return msg;
}

function toVN(buffer) {
    return new Promise((resolve, reject) => {
        const input = new PassThrough();
        const output = new PassThrough();
        const chunks = [];

        input.end(buffer);

        ffmpeg(input)
            .noVideo()
            .audioCodec('libopus')
            .format('ogg')
            .audioChannels(1)
            .audioFrequency(48000)
            .on('error', reject)
            .on('end', () => resolve(Buffer.concat(chunks)))
            .pipe(output);

        output.on('data', (c) => chunks.push(c));
    });
}

function generateWaveform(buffer, bars = 64) {
    return new Promise((resolve, reject) => {
        const input = new PassThrough();
        input.end(buffer);

        const chunks = [];

        ffmpeg(input)
            .audioChannels(1)
            .audioFrequency(16000)
            .format('s16le')
            .on('error', reject)
            .on('end', () => {
                const raw = Buffer.concat(chunks);
                const samples = raw.length / 2;
                const amps = [];

                for (let i = 0; i < samples; i++) {
                    amps.push(Math.abs(raw.readInt16LE(i * 2)) / 32768);
                }

                const size = Math.floor(amps.length / bars);
                if (size === 0) return resolve(undefined);

                const avg = Array.from({ length: bars }, (_, i) =>
                    amps
                        .slice(i * size, (i + 1) * size)
                        .reduce((a, b) => a + b, 0) / size,
                );

                const max = Math.max(...avg);
                if (max === 0) return resolve(undefined);

                resolve(
                    Buffer.from(
                        avg.map((v) => Math.floor((v / max) * 100)),
                    ).toString('base64'),
                );
            })
            .pipe()
            .on('data', (c) => chunks.push(c));
    });
}

// ─── Command ──────────────────────────────────────────────────────────────────
module.exports = {
    name: 'togroupstatus',
    aliases: ['groupstatus', 'gs'],
    category: 'owner',
    description: 'Post replied media or text as a WhatsApp Group Status.',
    usage: '.togroupstatus [caption] — use in a group, reply to media or provide text',
    ownerOnly: true,

    async execute(sock, msg, args, extra) {
        const from = extra.from;

        if (!extra.isGroup) {
            return extra.reply('❌ This command must be used inside a group.');
        }

        const caption = args.join(' ').trim();
        const ctxInfo = msg.message?.extendedTextMessage?.contextInfo;
        const hasQuoted = !!ctxInfo?.quotedMessage;

        // ── No quoted + no text → show usage ─────────────────────────────────
        if (!hasQuoted && !caption) {
            return extra.reply(
                `📌 *Group Status Usage*\n\n` +
                `• *.togroupstatus <text>*\n` +
                `• Reply to image/video/audio/sticker/document with *.togroupstatus <caption>*\n` +
                `• Or just *.togroupstatus* when replying to media (no caption needed)`,
            );
        }

        try {
            // ── CASE 1: Text-only group status ────────────────────────────────
            if (!hasQuoted) {
                await groupStatus(sock, from, {
                    text: caption,
                    backgroundColor: PURPLE_COLOR,
                });
                return extra.reply('💯');
            }

            // ── CASE 2: Quoted media ──────────────────────────────────────────
            const quotedMsg = ctxInfo.quotedMessage;
            const mtype = Object.keys(quotedMsg)[0] || '';

            const targetMessage = {
                key: {
                    remoteJid: from,
                    id: ctxInfo.stanzaId,
                    participant: ctxInfo.participant,
                },
                message: quotedMsg,
            };

            // IMAGE
            if (/image/i.test(mtype)) {
                const buf = await downloadMedia(quotedMsg, 'image');
                await groupStatus(sock, from, {
                    image: buf,
                    caption: caption || '',
                });
                return extra.reply('✅');
            }

            // STICKER
            if (/sticker/i.test(mtype)) {
                const buf = await downloadMedia(quotedMsg, 'sticker');
                await groupStatus(sock, from, {
                    image: buf,
                    caption: caption || '',
                });
                return extra.reply('✅');
            }

            // VIDEO
            if (/video/i.test(mtype)) {
                const buf = await downloadMedia(quotedMsg, 'video');
                await groupStatus(sock, from, {
                    video: buf,
                    caption: caption || '',
                });
                return extra.reply('✅');
            }

            // AUDIO
            if (/audio/i.test(mtype)) {
                const buf = await downloadMedia(quotedMsg, 'audio');

                let vn;
                try { vn = await toVN(buf); } catch { vn = buf; }

                let waveform;
                try { waveform = await generateWaveform(buf); } catch { waveform = undefined; }

                await groupStatus(sock, from, {
                    audio: vn,
                    mimetype: 'audio/ogg; codecs=opus',
                    ptt: true,
                    waveform,
                });
                return extra.reply('✅');
            }

            // DOCUMENT
            if (/document/i.test(mtype)) {
                const buf = await downloadMedia(quotedMsg, 'document');
                await groupStatus(sock, from, {
                    document: buf,
                    caption: caption || '',
                });
                return extra.reply('✅');
            }

            // Quoted text
            if (quotedMsg?.conversation || quotedMsg?.extendedTextMessage?.text) {
                const text =
                    quotedMsg.conversation ||
                    quotedMsg.extendedTextMessage?.text ||
                    caption;
                await groupStatus(sock, from, {
                    text,
                    backgroundColor: PURPLE_COLOR,
                });
                return extra.reply('💯');
            }

            return extra.reply('❌ Unsupported media type. Reply to an image, video, audio, sticker, or document.');

        } catch (err) {
            console.error('[togroupstatus] error:', err);
            return extra.reply(`❌ Failed to post group status: ${err.message}`);
        }
    },
};
