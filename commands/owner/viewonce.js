/**
 * ViewOnce Command - Reveal view-once messages (forwards to owner's DM)
 */

const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

module.exports = {
    name: 'viewonce',
    aliases: ['vv', 'rvo', 'readvo', 'readviewonce'],
    category: 'owner',
    ownerOnly: true,
    description: 'Reveal view-once messages — forwards media to owner DM',
    usage: '.vv (reply to a view-once message)',

    async execute(sock, msg, args, extra) {
        const chatId   = extra.from;
        const ownerJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';

        try {
            // ── Extract quoted context ─────────────────────────────────────
            const ctx =
                msg.message?.extendedTextMessage?.contextInfo ||
                msg.message?.imageMessage?.contextInfo ||
                msg.message?.videoMessage?.contextInfo ||
                msg.message?.buttonsResponseMessage?.contextInfo ||
                msg.message?.listResponseMessage?.contextInfo;

            if (!ctx?.quotedMessage) {
                return await sock.sendMessage(
                    chatId,
                    { text: '🗑️ Reply to a *view-once* message to reveal it.' },
                    { quoted: msg }
                );
            }

            const quoted = ctx.quotedMessage;

            // ── Check that it's actually a view-once ───────────────────────
            const hasViewOnce =
                !!quoted.viewOnceMessageV2 ||
                !!quoted.viewOnceMessageV2Extension ||
                !!quoted.viewOnceMessage ||
                !!quoted?.imageMessage?.viewOnce ||
                !!quoted?.videoMessage?.viewOnce ||
                !!quoted?.audioMessage?.viewOnce;

            if (!hasViewOnce) {
                return await sock.sendMessage(
                    chatId,
                    { text: '❌ That is not a view-once message!' },
                    { quoted: msg }
                );
            }

            // ── Unwrap the actual media message ────────────────────────────
            let actualMsg = null;
            let mtype     = null;

            if (quoted.viewOnceMessageV2Extension?.message) {
                actualMsg = quoted.viewOnceMessageV2Extension.message;
                mtype     = Object.keys(actualMsg)[0];
            } else if (quoted.viewOnceMessageV2?.message) {
                actualMsg = quoted.viewOnceMessageV2.message;
                mtype     = Object.keys(actualMsg)[0];
            } else if (quoted.viewOnceMessage?.message) {
                actualMsg = quoted.viewOnceMessage.message;
                mtype     = Object.keys(actualMsg)[0];
            } else if (quoted.imageMessage?.viewOnce) {
                actualMsg = { imageMessage: quoted.imageMessage };
                mtype     = 'imageMessage';
            } else if (quoted.videoMessage?.viewOnce) {
                actualMsg = { videoMessage: quoted.videoMessage };
                mtype     = 'videoMessage';
            } else if (quoted.audioMessage?.viewOnce) {
                actualMsg = { audioMessage: quoted.audioMessage };
                mtype     = 'audioMessage';
            }

            if (!actualMsg || !mtype) {
                return await sock.sendMessage(
                    chatId,
                    { text: '❌ Unsupported view-once message type.' },
                    { quoted: msg }
                );
            }

            // ── Download buffer ────────────────────────────────────────────
            const downloadType =
                mtype === 'imageMessage' ? 'image' :
                mtype === 'videoMessage' ? 'video' : 'audio';

            const stream = await downloadContentFromMessage(actualMsg[mtype], downloadType);
            let buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

            const caption = actualMsg[mtype]?.caption || '';

            // ── Forward to owner DM ────────────────────────────────────────
            if (mtype === 'imageMessage') {
                await sock.sendMessage(ownerJid, {
                    image: buffer,
                    caption: caption || '🖼️ Retrieved ViewOnce Image'
                });
            } else if (mtype === 'videoMessage') {
                await sock.sendMessage(ownerJid, {
                    video: buffer,
                    caption: caption || '🎬 Retrieved ViewOnce Video',
                    mimetype: 'video/mp4'
                });
            } else {
                await sock.sendMessage(ownerJid, {
                    audio: buffer,
                    mimetype: actualMsg[mtype]?.mimetype || 'audio/mp4',
                    ptt: false
                });
            }

            // ── React ✅ in the original chat ──────────────────────────────
            await sock.sendMessage(chatId, {
                react: { text: '✅', key: msg.key }
            });

        } catch (error) {
            console.error('ViewOnce command error:', error);
            await sock.sendMessage(
                chatId,
                { text: `❌ Failed to reveal view-once: ${error.message || 'Unknown error'}` },
                { quoted: msg }
            );
        }
    }
};
