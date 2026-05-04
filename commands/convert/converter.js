const fs = require('fs');
const path = require('path');
const os = require('os');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { toAudio } = require(require('path').join(global.__CORE__, 'utils', 'converter'));
const { webp2mp4 } = require(require('path').join(global.__CORE__, 'utils', 'webp2mp4'));

const TEMP_DIR = path.join(os.tmpdir(), 'june-x-conv');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

async function downloadQuoted(sock, msg) {
    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    if (!ctx?.quotedMessage) return null;
    const fullQuoted = {
        key: {
            remoteJid: ctx.remoteJid || msg.key.remoteJid,
            fromMe: false,
            id: ctx.stanzaId,
            participant: ctx.participant
        },
        message: ctx.quotedMessage
    };
    return {
        buffer: await downloadMediaMessage(fullQuoted, 'buffer', {}, { logger: undefined }),
        quotedMsg: ctx.quotedMessage
    };
}

module.exports = [
    {
        name: 'tomp3',
        aliases: ['toaudio', 'extractaudio', 'mp3'],
        category: 'convert',
        description: 'Extract audio from a video and send as MP3',
        usage: '.tomp3 (reply to video)',

        async execute(sock, msg, args, { reply, react }) {
            const chatId = msg.key.remoteJid;
            const ctx = msg.message?.extendedTextMessage?.contextInfo;
            if (!ctx?.quotedMessage?.videoMessage) {
                return reply('❌ Reply to a *video* to extract its audio.');
            }
            await react('🎵');
            try {
                const { buffer } = await downloadQuoted(sock, msg);
                if (!buffer || !buffer.length) throw new Error('Download failed');
                const converted = await toAudio(buffer, 'mp4');
                await sock.sendMessage(chatId, {
                    audio: converted,
                    mimetype: 'audio/mpeg',
                    fileName: 'audio.mp3'
                }, { quoted: msg });
            } catch (e) {
                reply(`❌ Conversion failed: ${e.message}`);
            }
        }
    },

    {
        name: 'tovideo',
        aliases: ['stickervideo', 'webptomp4', 'stickertomp4'],
        category: 'convert',
        description: 'Convert an animated WebP sticker to an MP4 video',
        usage: '.tovideo (reply to animated sticker)',

        async execute(sock, msg, args, { reply, react }) {
            const chatId = msg.key.remoteJid;
            const ctx = msg.message?.extendedTextMessage?.contextInfo;
            if (!ctx?.quotedMessage?.stickerMessage) {
                return reply('❌ Reply to an *animated sticker* to convert it to video.');
            }
            await react('🎬');
            try {
                const { buffer } = await downloadQuoted(sock, msg);
                if (!buffer || !buffer.length) throw new Error('Download failed');
                const mp4Buffer = await webp2mp4(buffer);
                if (!mp4Buffer || !mp4Buffer.length) throw new Error('Conversion returned empty output');
                await sock.sendMessage(chatId, {
                    video: mp4Buffer,
                    mimetype: 'video/mp4',
                    fileName: 'sticker.mp4'
                }, { quoted: msg });
            } catch (e) {
                reply(`❌ Conversion failed: ${e.message}`);
            }
        }
    }
];
