/**
 * ViewOnce Command
 *   .vv  — reveals view-once and forwards to owner's DM (private)
 *   .vv2 — reveals view-once and sends in the current chat
 *
 * No file-size limit: content is streamed to a temp file and sent via file
 * path so Baileys can upload in chunks regardless of how large the media is.
 */

const fs = require('fs');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { createTempFilePath, deleteTempFile } = require('../../utils/tempManager');

module.exports = {
    name: 'viewonce',
    aliases: ['vv', 'vv2', 'rvo', 'readvo', 'readviewonce'],
    category: 'owner',
    ownerOnly: true,
    description: 'Reveal view-once messages — .vv → owner DM | .vv2 → current chat',
    usage: '.vv (reply to a view-once) | .vv2 (reply to display here)',

    async execute(sock, msg, args, extra) {
        const chatId  = extra.from;
        const selfJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';

        // vv2 sends to current chat; vv sends to owner DM
        const sendToCurrentChat = extra.command === 'vv2';
        const targetJid = sendToCurrentChat ? chatId : selfJid;

        let tmpPath = null;
        try {
            // ── Extract quoted context ─────────────────────────────────────
            const ctx =
                msg.message?.extendedTextMessage?.contextInfo ||
                msg.message?.stickerMessage?.contextInfo ||
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
                !!quoted.viewOnceMessageV2Extension ||
                !!quoted.viewOnceMessageV2 ||
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

            // ── Stream to temp file (no memory limit) ─────────────────────
            const downloadType =
                mtype === 'imageMessage' ? 'image' :
                mtype === 'videoMessage' ? 'video' : 'audio';

            const ext =
                mtype === 'imageMessage' ? 'jpg' :
                mtype === 'videoMessage' ? 'mp4' : 'mp4';

            tmpPath = createTempFilePath('vv', ext);
            const writeStream = fs.createWriteStream(tmpPath);
            const dlStream    = await downloadContentFromMessage(actualMsg[mtype], downloadType);
            await new Promise((resolve, reject) => {
                dlStream.pipe(writeStream);
                writeStream.on('finish', resolve);
                writeStream.on('error', reject);
                dlStream.on('error', reject);
            });

            const caption = actualMsg[mtype]?.caption || '';

            // ── Send via file path — Baileys streams upload, no size cap ──
            if (mtype === 'imageMessage') {
                await sock.sendMessage(targetJid, {
                    image: { url: tmpPath },
                    caption: caption || '🖼️ *ViewOnce Image*'
                });
            } else if (mtype === 'videoMessage') {
                await sock.sendMessage(targetJid, {
                    video: { url: tmpPath },
                    caption: caption || '🎬 *ViewOnce Video*',
                    mimetype: 'video/mp4'
                });
            } else {
                await sock.sendMessage(targetJid, {
                    audio: { url: tmpPath },
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
        } finally {
            // Always clean up the temp file
            if (tmpPath) deleteTempFile(tmpPath);
        }
    }
};
