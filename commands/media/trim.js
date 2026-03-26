const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFile } = require("child_process");
const { downloadMediaMessage } = require('@whiskeysockets/baileys');

module.exports = {
    name: 'trim',
    aliases: ['trimvid', 'trimaudio', 'cut'],
    category: 'media',
    description: 'Trim an audio or video file to a specific time range',
    usage: '.trim <start> <end> (reply to an audio or video)',

    async execute(sock, msg, args) {
        const chatId = msg.key.remoteJid;

        try {
            await sock.sendMessage(chatId, { react: { text: "✂️", key: msg.key } });

            const tempDir = path.join(os.tmpdir(), "june-x-temp");
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

            if (!args || args.length < 2) {
                return sock.sendMessage(chatId, {
                    text: "❌ Reply to an audio or video file with start and end time.\n\nExample: `.trim 0:10 0:30`"
                }, { quoted: msg });
            }

            const [startTime, endTime] = args;

            const timeRegex = /^(\d{1,2}:)?[0-5]?\d:[0-5]?\d$/;
            if (!timeRegex.test(startTime) || !timeRegex.test(endTime)) {
                return sock.sendMessage(chatId, {
                    text: "⚠️ Invalid time format. Use MM:SS or HH:MM:SS"
                }, { quoted: msg });
            }

            const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
            if (!contextInfo?.quotedMessage) {
                return sock.sendMessage(chatId, {
                    text: "❌ Please reply to an audio or video file with this command."
                }, { quoted: msg });
            }

            const quotedMsg = contextInfo.quotedMessage;
            const audioMsg = quotedMsg.audioMessage;
            const videoMsg = quotedMsg.videoMessage;

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

            const mediaBuffer = await downloadMediaMessage(fullQuotedMessage, 'buffer', {}, { logger: undefined });

            const isAudio = !!audioMsg;
            const inputExt = isAudio ? '.ogg' : '.mp4';
            const inputPath = path.join(tempDir, `input_${Date.now()}${inputExt}`);
            fs.writeFileSync(inputPath, mediaBuffer);

            const outputExt = isAudio ? ".mp3" : ".mp4";
            const outputPath = path.join(tempDir, `trim_${Date.now()}${outputExt}`);

            await new Promise((resolve, reject) => {
                execFile('ffmpeg', [
                    '-i', inputPath,
                    '-ss', startTime,
                    '-to', endTime,
                    '-c', 'copy',
                    outputPath
                ], (error) => {
                    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
                    if (error) return reject(new Error(`FFmpeg error: ${error.message}`));
                    resolve();
                });
            });

            if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
                throw new Error("Trimming failed or output file is empty!");
            }

            await sock.sendMessage(chatId, { text: `_✂️ Trimmed clip ready!_` }, { quoted: msg });

            const trimmedBuffer = fs.readFileSync(outputPath);
            const messageContent = isAudio
                ? { audio: trimmedBuffer, mimetype: "audio/mpeg", fileName: "trimmed.mp3" }
                : { video: trimmedBuffer, mimetype: "video/mp4", fileName: "trimmed.mp4" };

            await sock.sendMessage(chatId, messageContent, { quoted: msg });

            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);

        } catch (error) {
            console.error("Trim command error:", error);
            return sock.sendMessage(chatId, {
                text: `🚫 Error: ${error.message}`
            }, { quoted: msg });
        }
    }
};
