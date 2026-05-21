/**
 * Shazam Command — Identify songs via ACRCloud + Spotify download.
 * Identify: ACRCloud SDK (identify-eu-west-1.acrcloud.com)
 * Download: api.nexray.eu.cc/downloader/spotifyplay
 */

const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { sendButtons } = require('gifted-btns');
const acrcloud = require('acrcloud');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../../config');

const RETRY_DELAY = 3000;

const acr = new acrcloud({
    host:          'identify-eu-west-1.acrcloud.com',
    access_key:    '2631ab98e77b49509e3edcf493757300',
    access_secret: 'KKbVWlTNCL3JjxjrWnywMdvQGanyhKRN0fpQxyUo',
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function getResponseSender(msg) {
    return msg.key?.participant || msg.key?.remoteJid;
}

async function downloadMedia(msgContent) {
    const types = ['audioMessage', 'videoMessage'];
    for (const type of types) {
        if (msgContent[type]) {
            const mediaType = type === 'audioMessage' ? 'audio' : 'video';
            const stream = await downloadContentFromMessage(msgContent[type], mediaType);
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            return Buffer.concat(chunks);
        }
    }
    return null;
}

async function withRetry(fn, retries = 3, delayMs = RETRY_DELAY) {
    let lastErr;
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (e) {
            lastErr = e;
            const isBusy = e.message?.toLowerCase().includes('busy') ||
                           e.message?.toLowerCase().includes('try again');
            if (i < retries - 1 && isBusy) {
                await new Promise(r => setTimeout(r, delayMs));
            } else if (!isBusy) {
                throw e;
            }
        }
    }
    throw lastErr;
}

async function downloadSpotify(exactQuery) {
    return withRetry(async () => {
        const res = await axios.get(
            `https://api.nexray.eu.cc/downloader/spotifyplay?q=${encodeURIComponent(exactQuery)}`,
            { timeout: 90000 }
        );
        const result = res.data?.result;
        if (!res.data?.status || !result?.download_url) {
            throw new Error('Download API returned no URL');
        }
        return {
            downloadUrl: result.download_url,
            title:       result.title  || '',
            artist:      result.artist || '',
        };
    });
}

function extractButtonResponseId(msg) {
    return (
        msg.message?.buttonsResponseMessage?.selectedButtonId ||
        msg.message?.templateButtonReplyMessage?.selectedId ||
        msg.message?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson ||
        null
    );
}

function getDownloadButtons(dateNow) {
    const prefix = config.prefix || '.';
    return [
        { id: `${prefix}shazamdl_audio_${dateNow}`,    text: '🎶 Audio' },
        { id: `${prefix}shazamdl_audiodoc_${dateNow}`, text: '📄 Audio Document' },
    ];
}

// ── Module ────────────────────────────────────────────────────────────────────

module.exports = {
    name: 'shazam',
    aliases: ['whatsong', 'identify', 'songtag'],
    category: 'media',
    description: 'Identify a song from audio or video',
    usage: '.shazam — reply to an audio / video message',

    async execute(sock, msg, args, extra) {
        const from = extra.from;

        // React first so the user always sees an immediate response
        await sock.sendMessage(from, { react: { text: '🎵', key: msg.key } });

        // Resolve quoted message — try extra.quoted first (framework-provided),
        // then fall back to raw contextInfo
        const msgContent =
            extra?.quoted ||
            msg.message?.extendedTextMessage?.contextInfo?.quotedMessage ||
            null;

        if (!msgContent) {
            return extra.reply(
                `🎵 *WhatSong / Shazam*\n\n` +
                `❌ Please reply to an *audio* or *video* message to identify the song!`
            );
        }

        const hasMedia = msgContent.audioMessage || msgContent.videoMessage;
        if (!hasMedia) {
            return extra.reply(
                `🎵 *WhatSong / Shazam*\n\n` +
                `❌ Unsupported media type!\n\n` +
                `✅ Supported:\n• Audio / Voice notes\n• Videos with audio`
            );
        }

        await extra.reply('🔍 Analyzing the media, please wait...');

        try {
            // ── Download buffer ───────────────────────────────────────────────
            const buffer = await downloadMedia(msgContent);
            if (!buffer || buffer.length === 0) {
                throw new Error('Failed to download the media');
            }

            // ── ACRCloud identify ─────────────────────────────────────────────
            const { status, metadata } = await acr.identify(buffer);

            if (status.code !== 0) {
                await sock.sendMessage(from, { react: { text: '❌', key: msg.key } });
                return extra.reply(`❌ Could not identify the song.\n\n📌 *Reason:* ${status.msg}`);
            }

            const song        = metadata.music[0];
            const title       = song.title       || 'Unknown';
            const artists     = song.artists      || [];
            const artistNames = artists.map(a => a.name).join(', ') || 'Unknown';
            const album       = song.album?.name  || 'N/A';
            const genres      = song.genres?.map(g => g.name).join(', ') || 'N/A';
            const release     = song.release_date || 'N/A';

            let txt = `🎶 *SONG IDENTIFIED* 🎶\n\n`;
            txt += `📝 *Title:*     ${title}\n`;
            txt += `🎤 *Artist(s):* ${artistNames}\n`;
            txt += `💿 *Album:*     ${album}\n`;
            txt += `🎸 *Genre(s):* ${genres}\n`;
            txt += `📅 *Released:* ${release}\n\n`;
            txt += `*Select a format to download:*`;

            await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });

            // ── Send result + download buttons ────────────────────────────────
            const dateNow        = Date.now();
            const prefix         = config.prefix || '.';
            const originalSender = msg.key.participant || msg.key.remoteJid;

            await sendButtons(sock, from, {
                title:   '🎵 SHAZAM RESULT',
                text:    txt.trim(),
                footer:  `Made by ${config.botName}`,
                buttons: getDownloadButtons(dateNow),
            }, { quoted: msg });

            // ── Listen for format button press ────────────────────────────────
            const handleDownload = async (event) => {
                const messageData = event.messages[0];
                if (!messageData?.message) return;

                const selectedId = extractButtonResponseId(messageData);
                if (!selectedId) return;
                if (!selectedId.includes('shazamdl_') || !selectedId.includes(`_${dateNow}`)) return;
                if (messageData.key?.remoteJid !== from) return;

                const responseSender = getResponseSender(messageData);
                if (from.endsWith('@g.us') && responseSender !== originalSender) return;

                sock.ev.off('messages.upsert', handleDownload);
                clearTimeout(dlTimer);

                await sock.sendMessage(from, { react: { text: '⬇️', key: msg.key } });

                try {
                    const formatType = selectedId.replace(prefix, '').split('_')[1]; // audio | audiodoc

                    const exactQuery = `${artistNames} - ${title}`;
                    const apiData    = await downloadSpotify(exactQuery);

                    const tempDir  = path.join(__dirname, 'temp');
                    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
                    const filePath = path.join(tempDir, `shazam_${dateNow}.mp3`);

                    const audioStream = await axios({
                        method:       'get',
                        url:          apiData.downloadUrl,
                        responseType: 'stream',
                        timeout:      600000,
                    });

                    const writer = fs.createWriteStream(filePath);
                    audioStream.data.pipe(writer);
                    await new Promise((resolve, reject) => {
                        writer.on('finish', resolve);
                        writer.on('error', reject);
                    });

                    if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
                        throw new Error('Download failed — file is empty');
                    }

                    const rawTitle   = apiData.title || title || '';
                    const cleanTitle = rawTitle.replace(/[^\w\s.-]/gi, '').substring(0, 100);

                    if (formatType === 'audio') {
                        await sock.sendMessage(from, {
                            audio:    { url: filePath },
                            mimetype: 'audio/mpeg',
                        }, { quoted: messageData });

                    } else if (formatType === 'audiodoc') {
                        await sock.sendMessage(from, {
                            document: { url: filePath },
                            mimetype:  'audio/mpeg',
                            fileName:  `${cleanTitle}.mp3`,
                            caption:   `> ${config.botName}`,
                        }, { quoted: messageData });
                    }

                    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                    await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });

                } catch (dlErr) {
                    console.error('[shazam] download error:', dlErr.message);
                    await sock.sendMessage(from, { react: { text: '❌', key: msg.key } });
                    await sock.sendMessage(from, {
                        text: `🚫 Download failed: ${dlErr.message}\n\n_Try again later._`
                    }, { quoted: messageData });
                }
            };

            sock.ev.on('messages.upsert', handleDownload);
            const dlTimer = setTimeout(
                () => sock.ev.off('messages.upsert', handleDownload),
                120000
            );

        } catch (err) {
            console.error('[SHAZAM] Error:', err.message);
            await sock.sendMessage(from, { react: { text: '❌', key: msg.key } });
            await extra.reply(
                `❌ *Shazam Error*\n\n` +
                `🚫 ${err.message || 'Something went wrong.'}\n\n` +
                `💡 Tips:\n• Make sure the audio is clear\n• Try a shorter clip\n• Retry later`
            );
        }
    },
};
