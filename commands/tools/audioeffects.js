const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { toPTT } = require('../../utils/converter');
const ffmpegPath = require('ffmpeg-static');

const TEMP_DIR = path.join(os.tmpdir(), 'june-x-audio');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

function rand(ext) {
    return path.join(TEMP_DIR, `${Date.now()}_${Math.floor(Math.random() * 9999)}${ext}`);
}

async function downloadAudio(sock, msg) {
    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    if (!ctx?.quotedMessage) return null;
    const quotedMsg = ctx.quotedMessage;
    if (!quotedMsg.audioMessage) return null;

    const fullQuoted = {
        key: {
            remoteJid: ctx.remoteJid || msg.key.remoteJid,
            fromMe: false,
            id: ctx.stanzaId,
            participant: ctx.participant
        },
        message: quotedMsg
    };

    const buffer = await downloadMediaMessage(fullQuoted, 'buffer', {}, { logger: undefined });
    const inputPath = rand('.ogg');
    fs.writeFileSync(inputPath, buffer);
    return { inputPath, buffer };
}

function runFfmpeg(inputPath, outputPath, ffArgs) {
    return new Promise((resolve, reject) => {
        execFile(ffmpegPath, ['-y', '-i', inputPath, ...ffArgs, outputPath], (err) => {
            try { fs.unlinkSync(inputPath); } catch (_) {}
            if (err) return reject(err);
            resolve();
        });
    });
}

async function applyEffect(sock, msg, ffArgs, replyFn) {
    const chatId = msg.key.remoteJid;
    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    if (!ctx?.quotedMessage?.audioMessage) {
        return replyFn('Reply to an *audio file* with this command to apply the effect.');
    }
    try {
        const { inputPath, buffer } = await downloadAudio(sock, msg) || {};
        if (!inputPath) return replyFn('Reply to an *audio file* with this command.');
        const outputPath = rand('.mp3');
        await runFfmpeg(inputPath, outputPath, ffArgs);
        if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) throw new Error('FFmpeg produced no output');
        const result = fs.readFileSync(outputPath);
        fs.unlinkSync(outputPath);
        await sock.sendMessage(chatId, { audio: result, mimetype: 'audio/mpeg', fileName: 'effect.mp3' }, { quoted: msg });
    } catch (err) {
        replyFn(`🚫 Error: ${err.message}`);
    }
}

module.exports = [
    {
        name: 'bass',
        aliases: ['bassboost'],
        category: 'tools',
        description: 'Add bass boost to an audio file',
        usage: '.bass (reply to audio)',
        async execute(sock, msg, args, { reply }) {
            await sock.sendMessage(msg.key.remoteJid, { react: { text: '🔊', key: msg.key } });
            await applyEffect(sock, msg, ['-af', 'equalizer=f=54:width_type=o:width=2:g=20'], reply);
        }
    },
    {
        name: 'blown',
        aliases: [],
        category: 'tools',
        description: 'Apply blown/pitched-down effect to audio',
        usage: '.blown (reply to audio)',
        async execute(sock, msg, args, { reply }) {
            await sock.sendMessage(msg.key.remoteJid, { react: { text: '💨', key: msg.key } });
            await applyEffect(sock, msg, ['-af', 'atempo=4/4,asetrate=44500*2/3'], reply);
        }
    },
    {
        name: 'earrape',
        aliases: [],
        category: 'tools',
        description: 'Apply ear-rape (extreme volume) effect to audio',
        usage: '.earrape (reply to audio)',
        async execute(sock, msg, args, { reply }) {
            await sock.sendMessage(msg.key.remoteJid, { react: { text: '📢', key: msg.key } });
            await applyEffect(sock, msg, ['-af', 'volume=12'], reply);
        }
    },
    {
        name: 'volaudio',
        aliases: ['volume'],
        category: 'tools',
        description: 'Boost the volume of an audio file (2x)',
        usage: '.volaudio (reply to audio)',
        async execute(sock, msg, args, { reply }) {
            await sock.sendMessage(msg.key.remoteJid, { react: { text: '🔉', key: msg.key } });
            await applyEffect(sock, msg, ['-filter:a', 'volume=2.0'], reply);
        }
    },
    {
        name: 'treble',
        aliases: ['trebleboost'],
        category: 'tools',
        description: 'Boost treble frequencies of an audio file',
        usage: '.treble (reply to audio)',
        async execute(sock, msg, args, { reply }) {
            await sock.sendMessage(msg.key.remoteJid, { react: { text: '🎶', key: msg.key } });
            await applyEffect(sock, msg, ['-af', 'equalizer=f=10000:width_type=o:width=2:g=15'], reply);
        }
    },
    {
        name: 'fast',
        aliases: ['speedup'],
        category: 'tools',
        description: 'Speed up an audio file (1.5x)',
        usage: '.fast (reply to audio)',
        async execute(sock, msg, args, { reply }) {
            await sock.sendMessage(msg.key.remoteJid, { react: { text: '⏩', key: msg.key } });
            await applyEffect(sock, msg, ['-filter:a', 'atempo=1.5'], reply);
        }
    },
    {
        name: 'slow',
        aliases: ['slowdown'],
        category: 'tools',
        description: 'Slow down an audio file (0.8x)',
        usage: '.slow (reply to audio)',
        async execute(sock, msg, args, { reply }) {
            await sock.sendMessage(msg.key.remoteJid, { react: { text: '⏪', key: msg.key } });
            await applyEffect(sock, msg, ['-filter:a', 'atempo=0.8'], reply);
        }
    },
    {
        name: 'reverse',
        aliases: ['audioreverse'],
        category: 'tools',
        description: 'Reverse an audio file',
        usage: '.reverse (reply to audio)',
        async execute(sock, msg, args, { reply }) {
            await sock.sendMessage(msg.key.remoteJid, { react: { text: '🔄', key: msg.key } });
            await applyEffect(sock, msg, ['-filter_complex', 'areverse'], reply);
        }
    },
    {
        name: 'echo',
        aliases: ['audioecho'],
        category: 'tools',
        description: 'Add echo effect to an audio file',
        usage: '.echo (reply to audio)',
        async execute(sock, msg, args, { reply }) {
            await sock.sendMessage(msg.key.remoteJid, { react: { text: '🔁', key: msg.key } });
            await applyEffect(sock, msg, ['-filter:a', 'aecho=0.8:0.9:1000:0.3'], reply);
        }
    },
    {
        name: 'robot',
        aliases: ['robotvoice'],
        category: 'tools',
        description: 'Apply robot voice effect to audio',
        usage: '.robot (reply to audio)',
        async execute(sock, msg, args, { reply }) {
            await sock.sendMessage(msg.key.remoteJid, { react: { text: '🤖', key: msg.key } });
            await applyEffect(sock, msg, [
                '-filter_complex',
                'afftfilt=real=\'hypot(re,im)*sin(0)\':imag=\'hypot(re,im)*cos(0)\':win_size=512:overlap=0.75'
            ], reply);
        }
    },
    {
        name: 'deep',
        aliases: ['deepvoice'],
        category: 'tools',
        description: 'Apply deep/low voice effect to audio',
        usage: '.deep (reply to audio)',
        async execute(sock, msg, args, { reply }) {
            await sock.sendMessage(msg.key.remoteJid, { react: { text: '🎤', key: msg.key } });
            await applyEffect(sock, msg, ['-filter:a', 'asetrate=44100*0.7,aresample=44100'], reply);
        }
    },
    {
        name: 'chipmunk',
        aliases: ['squeak'],
        category: 'tools',
        description: 'Apply chipmunk/high-pitch effect to audio',
        usage: '.chipmunk (reply to audio)',
        async execute(sock, msg, args, { reply }) {
            await sock.sendMessage(msg.key.remoteJid, { react: { text: '🐿️', key: msg.key } });
            await applyEffect(sock, msg, ['-filter:a', 'asetrate=44100*1.5,aresample=44100'], reply);
        }
    },
    {
        name: 'nightcore',
        aliases: [],
        category: 'tools',
        description: 'Apply nightcore effect to audio',
        usage: '.nightcore (reply to audio)',
        async execute(sock, msg, args, { reply }) {
            await sock.sendMessage(msg.key.remoteJid, { react: { text: '🌙', key: msg.key } });
            await applyEffect(sock, msg, ['-filter:a', 'atempo=1.06,asetrate=44100*1.25'], reply);
        }
    },
    {
        name: 'instrumental',
        aliases: [],
        category: 'tools',
        description: 'Extract instrumental from audio (stereo processing)',
        usage: '.instrumental (reply to audio)',
        async execute(sock, msg, args, { reply }) {
            await sock.sendMessage(msg.key.remoteJid, { react: { text: '🎸', key: msg.key } });
            await applyEffect(sock, msg, ['-af', 'pan=stereo|c0=c0|c1=c1,aresample=async=1:first_pts=0'], reply);
        }
    },
    {
        name: 'vocalremove',
        aliases: ['removevocal', 'novocal'],
        category: 'tools',
        description: 'Remove vocals from an audio file (stereo cancellation)',
        usage: '.vocalremove (reply to audio)',
        async execute(sock, msg, args, { reply }) {
            await sock.sendMessage(msg.key.remoteJid, { react: { text: '🎵', key: msg.key } });
            await applyEffect(sock, msg, ['-af', 'pan=stereo|c0=c0|c1=-1*c1'], reply);
        }
    },
    {
        name: 'karaoke',
        aliases: [],
        category: 'tools',
        description: 'Create a karaoke version of an audio file',
        usage: '.karaoke (reply to audio)',
        async execute(sock, msg, args, { reply }) {
            await sock.sendMessage(msg.key.remoteJid, { react: { text: '🎤', key: msg.key } });
            await applyEffect(sock, msg, ['-af', 'stereotools=mode=ms>lr'], reply);
        }
    },
    {
        name: 'toptt',
        aliases: ['tovn'],
        category: 'tools',
        description: 'Convert an audio file to a WhatsApp voice note (PTT)',
        usage: '.toptt (reply to audio)',
        async execute(sock, msg, args, { reply }) {
            const chatId = msg.key.remoteJid;
            const ctx = msg.message?.extendedTextMessage?.contextInfo;
            if (!ctx?.quotedMessage?.audioMessage) {
                return reply('Reply to an *audio file* to convert it to a voice note.');
            }
            await sock.sendMessage(chatId, { react: { text: '🗣️', key: msg.key } });
            try {
                const fullQuoted = {
                    key: {
                        remoteJid: ctx.remoteJid || chatId,
                        fromMe: false,
                        id: ctx.stanzaId,
                        participant: ctx.participant
                    },
                    message: ctx.quotedMessage
                };
                const buffer = await downloadMediaMessage(fullQuoted, 'buffer', {}, { logger: undefined });
                const pttBuffer = await toPTT(buffer, 'ogg');
                await sock.sendMessage(chatId, {
                    audio: pttBuffer,
                    mimetype: 'audio/ogg; codecs=opus',
                    ptt: true
                }, { quoted: msg });
            } catch (err) {
                reply(`🚫 Error: ${err.message}`);
            }
        }
    }
];
