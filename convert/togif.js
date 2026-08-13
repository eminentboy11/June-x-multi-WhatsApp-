/**
 * To GIF — re-send a video as a WhatsApp GIF (gifPlayback: true).
 * Reply to a video / gif / animated sticker, or caption a video with .togif.
 *
 * WhatsApp does not accept real .gif files. We send H.264 MP4 with gifPlayback.
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const ffmpegPath = require('../../utils/ffmpegPath');
const { getTempDir } = require('../../utils/tempManager');

const MAX_SECONDS = 45;
const MAX_BYTES = 16 * 1024 * 1024;

function unwrapMessage(message) {
    let m = message || {};
    if (m.ephemeralMessage?.message) m = m.ephemeralMessage.message;
    if (m.viewOnceMessageV2Extension?.message) m = m.viewOnceMessageV2Extension.message;
    if (m.viewOnceMessageV2?.message) m = m.viewOnceMessageV2.message;
    if (m.viewOnceMessage?.message) m = m.viewOnceMessage.message;
    if (m.documentWithCaptionMessage?.message) m = m.documentWithCaptionMessage.message;
    return m;
}

function findSource(msg) {
    const own = unwrapMessage(msg.message);
    if (own.videoMessage) {
        return { kind: 'video', target: msg, video: own.videoMessage };
    }
    if (own.documentMessage?.mimetype?.startsWith('video/')) {
        return { kind: 'video', target: msg, video: own.documentMessage };
    }

    const ctx =
        msg.message?.extendedTextMessage?.contextInfo ||
        msg.message?.imageMessage?.contextInfo ||
        msg.message?.videoMessage?.contextInfo ||
        null;
    const quoted = unwrapMessage(ctx?.quotedMessage);
    if (!quoted || !ctx) return null;

    const target = {
        key: {
            remoteJid: ctx.remoteJid || msg.key.remoteJid,
            fromMe: false,
            id: ctx.stanzaId,
            participant: ctx.participant,
        },
        message: quoted,
    };

    if (quoted.videoMessage) {
        return { kind: 'video', target, video: quoted.videoMessage };
    }
    if (quoted.documentMessage?.mimetype?.startsWith('video/')) {
        return { kind: 'video', target, video: quoted.documentMessage };
    }
    if (quoted.stickerMessage?.isAnimated) {
        return { kind: 'sticker', target, sticker: quoted.stickerMessage };
    }
    return null;
}

function probeDuration(filePath) {
    return new Promise(resolve => {
        execFile(ffmpegPath, ['-i', filePath], (_err, _stdout, stderr) => {
            const m = (stderr || '').match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
            if (!m) return resolve(0);
            resolve((+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]));
        });
    });
}

function runFfmpeg(args) {
    return new Promise((resolve, reject) => {
        execFile(ffmpegPath, args, (error, _stdout, stderr) => {
            if (error) {
                const tail = (stderr || '').split('\n').slice(-4).join(' ').trim();
                return reject(new Error(tail || error.message));
            }
            resolve();
        });
    });
}

module.exports = {
    name: 'togif',
    aliases: ['asgif', 'sendgif', 'videogif'],
    category: 'convert',
    description: 'Send a video as a WhatsApp GIF',
    usage: '.togif (reply to a video, gif, or animated sticker)',

    async execute(sock, msg, _args, extra) {
        const chatId = extra.from;
        const ts = Date.now();
        const inputFile = path.join(getTempDir(), `gif_in_${ts}.tmp`);
        const outputFile = path.join(getTempDir(), `gif_out_${ts}.mp4`);

        try {
            const source = findSource(msg);
            if (!source) {
                return extra.reply(
                    '🎞️ Reply to a *video*, *gif*, or *animated sticker* with `.togif`.\n' +
                    'You can also send a video with `.togif` as the caption.'
                );
            }

            if (extra.react) await extra.react('🎞️').catch(() => {});

            const buf = await downloadMediaMessage(
                source.target,
                'buffer',
                {},
                { logger: undefined, reuploadRequest: sock.updateMediaMessage }
            );
            if (!buf || !buf.length) throw new Error('Failed to download the media.');

            // Animated sticker → mp4 via existing converter, then mark as gif
            if (source.kind === 'sticker') {
                const { webp2mp4 } = require('../../utils/webp2mp4');
                const mp4 = await webp2mp4(buf);
                if (!mp4?.length) throw new Error('Sticker conversion returned empty output.');
                if (mp4.length > MAX_BYTES) throw new Error('Converted GIF is larger than 16MB.');
                await sock.sendMessage(chatId, {
                    video: mp4,
                    gifPlayback: true,
                    mimetype: 'video/mp4',
                }, { quoted: msg });
                if (extra.react) await extra.react('✅').catch(() => {});
                return;
            }

            fs.writeFileSync(inputFile, buf);
            const duration = await probeDuration(inputFile);
            const trimArgs = duration > MAX_SECONDS ? ['-t', String(MAX_SECONDS)] : [];

            await runFfmpeg([
                '-y',
                '-i', inputFile,
                ...trimArgs,
                '-an',
                '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
                '-c:v', 'libx264',
                '-preset', 'veryfast',
                '-crf', '28',
                '-pix_fmt', 'yuv420p',
                '-movflags', '+faststart',
                '-f', 'mp4',
                outputFile,
            ]);

            if (!fs.existsSync(outputFile) || fs.statSync(outputFile).size === 0) {
                throw new Error('Conversion produced an empty file.');
            }
            const outBuf = fs.readFileSync(outputFile);
            if (outBuf.length > MAX_BYTES) throw new Error('Converted GIF is larger than 16MB.');

            await sock.sendMessage(chatId, {
                video: outBuf,
                gifPlayback: true,
                mimetype: 'video/mp4',
            }, { quoted: msg });

            if (extra.react) await extra.react('✅').catch(() => {});
        } catch (error) {
            console.error('[togif]', error.message);
            if (extra.react) await extra.react('❌').catch(() => {});

            // Last resort: try the original bytes as a gif if ffmpeg blew up
            try {
                const source = findSource(msg);
                if (source?.kind === 'video') {
                    const raw = await downloadMediaMessage(
                        source.target, 'buffer', {},
                        { logger: undefined, reuploadRequest: sock.updateMediaMessage }
                    );
                    if (raw?.length && raw.length <= MAX_BYTES) {
                        await sock.sendMessage(chatId, {
                            video: raw,
                            gifPlayback: true,
                            mimetype: 'video/mp4',
                        }, { quoted: msg });
                        return;
                    }
                }
            } catch (_) {}

            await extra.reply(`❌ ToGIF failed: ${error.message}`);
        } finally {
            for (const file of [inputFile, outputFile]) {
                try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch (_) {}
            }
        }
    },
};
