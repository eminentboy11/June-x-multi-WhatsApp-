/**
 * ViewOnce Command
 *   .vv  — reveals view-once and forwards to owner's DM (private)
 *   .vv2 — reveals view-once and sends in the current chat
 */

const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

module.exports = {
    name: 'viewonce',
    aliases: ['vv', 'vv2', 'rvo', 'readvo', 'readviewonce'],
    category: 'owner',
    ownerOnly: true,
    description: 'Reveal view-once messages — .vv → owner DM | .vv2 → current chat',
    usage: '.vv (reply to a view-once) | .vv2 (reply to display here)',

    async execute(sock, msg, args, extra) {
        const chatId   = extra.from;
        const selfJid  = sock.user.id.split(':')[0] + '@s.whatsapp.net';

        // vv2 sends to current chat; vv sends to owner DM
        const sendToCurrentChat = extra.command === 'vv2';
        const targetJid = sendToCurrentChat ? chatId : selfJid;

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
                    { text: sendToCurrentChat
                        ? '🗑️ Reply to a *view-once* message with *.vv2* to reveal it here.'
                        : '🗑️ Reply to a *view-once* message with *.vv* to reveal it in your DM.'
                    },
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

            // ── Send to target chat ────────────────────────────────────────
            if (mtype === 'imageMessage') {
                await sock.sendMessage(targetJid, {
                    image: buffer,
                    caption: caption || '🖼️ *ViewOnce Image*'
                });
            } else if (mtype === 'videoMessage') {
                await sock.sendMessage(targetJid, {
                    video: buffer,
                    caption: caption || '🎬 *ViewOnce Video*',
                    mimetype: 'video/mp4'
                });
            } else {
                await sock.sendMessage(targetJid, {
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
            await sock.sendMessage(
                chatId,
                { text: `❌ Failed to reveal view-once: ${error.message || 'Unknown error'}` },
                { quoted: msg }
            );
        }
    }
};
