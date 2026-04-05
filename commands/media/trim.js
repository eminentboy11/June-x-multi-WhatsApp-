const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { getTempDir, deleteTempFile } = require('../../utils/tempManager');

module.exports = {
    name: 'trim',
    aliases: ['trimvid', 'trimaudio', 'cut'],
    category: 'media',
    description: 'Trim an audio or video file to a specific time range',
    usage: '.trim <start> <end> (reply to an audio or video)',

    async execute(sock, msg, args) {
        const chatId = msg.key.remoteJid;
        const inputPath  = path.join(getTempDir(), `input_${Date.now()}`);
        const outputPath = path.join(getTempDir(), `trim_${Date.now()}`);

        try {
            await sock.sendMessage(chatId, { react: { text: "✂️", key: msg.key } });

            if (!args || args.length < 2) {
                return sock.sendMessage(chatId, {
                    text: "❌ Reply to an audio or video file with start and end time.\n\nExample: `.trim 0:10 0:30`"
                }, { quoted: msg });
            }

            const [startTime, endTime] = args;
            const timeRegex = /^(\d{1,2}:)?[0-5]?\d:[0-5]?\d$/;
            if (!timeRegex.test(startTime) || !timeRegex.test(endTime)) {
                return sock.sendMessage(chatId, {
                    text: "⚠️ Invalid time format. Use MM:SS or HH:MM:SS\nExample: `.trim 0:30 1:45`"
                }, { quoted: msg });
            }

            const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
            if (!contextInfo?.quotedMessage) {
                return sock.sendMessage(chatId, {
                    text: "❌ Please reply to an audio or video file with this command."
                }, { quoted: msg });
            }

            const quotedMsg = contextInfo.quotedMessage;
            const audioMsg  = quotedMsg.audioMessage;
            const videoMsg  = quotedMsg.videoMessage;

            if (!audioMsg && !videoMsg) {
                return sock.sendMessage(chatId, {
                    text: "❌ Unsupported media type. Please reply to an audio or video file."
                }, { quoted: msg });
            }

            const fullQuotedMessage = {
                key: {
                    remoteJid: contextInfo.remoteJid || chatId,
                    fromMe: false,
                    id: contextInfo.stanzaId,
                    participant: contextInfo.participant
                },
                message: quotedMsg
            };

            const mediaBuffer = await downloadMediaMessage(
                fullQuotedMessage, 'buffer', {},
                { logger: undefined, reuploadRequest: sock.updateMediaMessage }
            );

            if (!mediaBuffer || mediaBuffer.length === 0) {
                return sock.sendMessage(chatId, {
                    text: "❌ Failed to download the media. Please try again."
                }, { quoted: msg });
            }

            const isAudio = !!audioMsg;

            // Write with a neutral extension so ffmpeg probes the real format
            const inputFile  = inputPath  + (isAudio ? '.tmp' : '.tmp');
            const outputFile = outputPath + (isAudio ? '.mp3' : '.mp4');
            fs.writeFileSync(inputFile, mediaBuffer);

            // Build ffmpeg args
            // Audio: always re-encode to MP3 — avoids any codec/container mismatch
            //        (WhatsApp voice notes can be AAC in MP4, Opus in OGG, etc.)
            // Video: copy video stream as-is, re-encode audio to AAC to avoid mismatch
            const ffmpegArgs = isAudio
                ? [
                    '-y',
                    '-i', inputFile,
                    '-ss', startTime,
                    '-to', endTime,
                    '-vn',                  // no video
                    '-c:a', 'libmp3lame',   // always re-encode → no container mismatch
                    '-q:a', '2',            // VBR quality ~190 kbps
                    outputFile
                ]
                : [
                    '-y',
                    '-i', inputFile,
                    '-ss', startTime,
                    '-to', endTime,
                    '-c:v', 'copy',         // copy video stream (fast, no quality loss)
                    '-c:a', 'aac',          // re-encode audio to AAC for MP4 compatibility
                    '-b:a', '128k',
                    '-movflags', '+faststart',
                    outputFile
                ];

            await new Promise((resolve, reject) => {
                execFile('ffmpeg', ffmpegArgs, (error, _stdout, stderr) => {
                    deleteTempFile(inputFile);
                    if (error) {
                        console.error('[Trim] FFmpeg stderr:', stderr);
                        return reject(new Error(`FFmpeg failed: ${stderr?.split('\n').slice(-4).join(' ').trim() || error.message}`));
                    }
                    resolve();
                });
            });

            if (!fs.existsSync(outputFile) || fs.statSync(outputFile).size === 0) {
                throw new Error("Trim produced an empty file — check the time range.");
            }

            await sock.sendMessage(chatId, { text: `_✂️ Trimmed clip ready!_` }, { quoted: msg });

            const trimmedBuffer = fs.readFileSync(outputFile);
            const messageContent = isAudio
                ? { audio: trimmedBuffer, mimetype: "audio/mpeg", fileName: "trimmed.mp3" }
                : { video: trimmedBuffer, mimetype: "video/mp4",  fileName: "trimmed.mp4" };

            await sock.sendMessage(chatId, messageContent, { quoted: msg });

        } catch (error) {
            console.error("[Trim] Error:", error);
            return sock.sendMessage(chatId, {
                text: `🚫 Error: ${error.message}`
            }, { quoted: msg });
        } finally {
            // Clean up any leftover temp files
            [`${inputPath}.tmp`, `${outputPath}.mp3`, `${outputPath}.mp4`]
                .forEach(f => { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {} });
        }
    }
};
