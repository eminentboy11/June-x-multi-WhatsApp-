/**
 * Shazam Command - Identify songs from audio/video media
 * Self‑contained with Uguu (primary) + Catbox (fallback) uploaders
 */

const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

const DEBUG = true;
const UGUU_UPLOAD_URL = 'https://uguu.se/upload.php';

function debugLog(message, data = null) {
    if (DEBUG) {
        console.log(`[SHAZAM] ${message}`, data ? JSON.stringify(data, null, 2) : '');
    }
}

/**
 * Uploads a file to Uguu
 * @param {string} filePath - Path to the file
 * @returns {Promise<string>} - Direct file URL
 */
async function uploadFileUgu(filePath) {
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));

    const response = await axios.post(UGUU_UPLOAD_URL, form, {
        headers: form.getHeaders(),
        timeout: 30000
    });

    if (typeof response.data === 'string') {
        return response.data.trim();
    } else if (response.data && response.data.url) {
        return response.data.url;
    } else {
        throw new Error('Unexpected response from Uguu');
    }
}

/**
 * Uploads a file to Catbox (fallback)
 * @param {string} filePath - Path to the file
 * @returns {Promise<string>} - Direct file URL
 */
async function uploadFileCatbox(filePath) {
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', fs.createReadStream(filePath));

    const response = await axios.post('https://catbox.moe/user/api.php', form, {
        headers: form.getHeaders(),
        timeout: 30000
    });

    const url = response.data.trim();
    if (url.startsWith('http')) {
        return url;
    } else {
        throw new Error(`Catbox upload failed: ${url}`);
    }
}

// ---------- Media extraction helpers (unchanged) ----------
async function getMediaBuffer(message, type) {
    try {
        debugLog(`Checking for ${type} media...`);
        const m = message.message || {};
        let messageType, fileExt, downloadType;

        switch (type) {
            case 'audio':
                if (m.audioMessage) {
                    messageType = m.audioMessage;
                    fileExt = '.mp3';
                    downloadType = 'audio';
                    debugLog('Found audio message');
                }
                break;
            case 'video':
                if (m.videoMessage) {
                    messageType = m.videoMessage;
                    fileExt = '.mp4';
                    downloadType = 'video';
                    debugLog('Found video message');
                }
                break;
            case 'image':
                if (m.imageMessage) {
                    messageType = m.imageMessage;
                    fileExt = '.jpg';
                    downloadType = 'image';
                    debugLog('Found image message');
                }
                break;
        }

        if (messageType) {
            debugLog(`Downloading ${type} content...`);
            const stream = await downloadContentFromMessage(messageType, downloadType);
            const chunks = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }
            const buffer = Buffer.concat(chunks);
            debugLog(`Downloaded ${type} buffer size:`, { size: buffer.length, type });
            return { buffer, ext: fileExt, type };
        }

        debugLog(`No ${type} message found`);
        return null;
    } catch (error) {
        console.error(`[SHAZAM] Error getting ${type} buffer:`, error.message);
        return null;
    }
}

async function getQuotedMediaBuffer(message, type) {
    try {
        debugLog(`Checking quoted message for ${type}...`);
        const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage || null;
        if (!quoted) {
            debugLog('No quoted message found');
            return null;
        }
        debugLog('Found quoted message, checking for media...');
        return await getMediaBuffer({ message: quoted }, type);
    } catch (error) {
        console.error(`[SHAZAM] Error getting quoted ${type} buffer:`, error.message);
        return null;
    }
}

async function getAllMediaBuffers(message) {
    debugLog('Scanning for all media types...');
    const mediaTypes = ['audio', 'video', 'image'];

    // Check current message
    for (const type of mediaTypes) {
        const media = await getMediaBuffer(message, type);
        if (media) {
            debugLog(`Found media in current message:`, { type: media.type, size: media.buffer.length });
            return media;
        }
    }

    debugLog('No media found in current message, checking quoted...');

    // Check quoted message
    for (const type of mediaTypes) {
        const media = await getQuotedMediaBuffer(message, type);
        if (media) {
            debugLog(`Found media in quoted message:`, { type: media.type, size: media.buffer.length });
            return media;
        }
    }

    debugLog('No media found in current or quoted message');
    return null;
}

// ---------- Command definition ----------
module.exports = {
    name: 'shazam',
    aliases: ['whatsong', 'identify', 'find'],
    category: 'media',
    description: 'Identify a song from audio, voice note, or video using Shazam',
    usage: '.shazam (reply to or send an audio/video file)',

    async execute(sock, msg, args, extra) {
        const chatId = extra.from || msg.key.remoteJid;
        let tempPath = null;

        try {
            debugLog('Shazam command started', { chatId, messageId: msg.key.id });

            // React with a musical note to acknowledge
            await sock.sendMessage(chatId, {
                react: { text: '🎵', key: msg.key }
            });

            const media = await getAllMediaBuffers(msg);

            if (!media) {
                debugLog('No media found - sending instructions');
                await sock.sendMessage(chatId, {
                    text: 'Send or reply to\naudio/voice note\nvideo identify the song.\n\nSupported media:\n• Audio/Voice notes\n• Videos with audio.'
                }, { quoted: msg });  // <-- using original message for quoting
                return;
            }

            debugLog('Media found, creating temp file...', { type: media.type, size: media.buffer.length });

            const tempDir = path.join(__dirname, '../temp');
            if (!fs.existsSync(tempDir)) {
                debugLog('Creating temp directory...');
                fs.mkdirSync(tempDir, { recursive: true });
            }

            tempPath = path.join(tempDir, `${Date.now()}_${media.type}${media.ext}`);
            fs.writeFileSync(tempPath, media.buffer);
            debugLog('Temp file created:', { path: tempPath, size: media.buffer.length });

            // Upload with fallback
            let mediaUrl = '';
            try {
                debugLog('Trying Uguu upload...');
                mediaUrl = await uploadFileUgu(tempPath);
                debugLog('Uguu upload successful:', mediaUrl);
            } catch (uguError) {
                debugLog('Uguu upload failed:', uguError.message);
                debugLog('Falling back to Catbox...');
                try {
                    mediaUrl = await uploadFileCatbox(tempPath);
                    debugLog('Catbox upload successful:', mediaUrl);
                } catch (catboxError) {
                    debugLog('Catbox upload also failed:', catboxError.message);
                    throw new Error(`All upload methods failed: ${uguError.message} / ${catboxError.message}`);
                }
            }

            if (!mediaUrl) {
                debugLog('No media URL obtained from upload');
                await sock.sendMessage(chatId, { text: 'Failed to upload media – no URL returned.' }, { quoted: msg });
                return;
            }

            debugLog('Media uploaded successfully, URL:', mediaUrl);

            let resultText = '';
            try {
                debugLog('Calling Shazam API...', { url: mediaUrl });
                const response = await axios.get(`https://apiskeith.top/ai/shazam`, {
                    params: { url: mediaUrl },
                    timeout: 30000
                });

                debugLog('Shazam API response:', { status: response.status, data: response.data });

                const song = response.data?.result || response.data;

                if (song && (song.title || song.artists)) {
                    resultText = `🎶 *SONG IDENTIFIED ⬇️*\n\n` +
                                 `📝 *Title:* ${song.title || 'Unknown'}\n` +
                                 `🎤 *Artist:* ${song.artists || 'Unknown'}\n` +
                                 `💿 *Album:* ${song.album || 'N/A'}\n` +
                                 `📟 *Release:* ${song.release_date || 'N/A'}\n\n` +
                                 `📊 *Media Type:* ${media.type.charAt(0).toUpperCase() + media.type.slice(1)}`;
                    debugLog('Song identified successfully');
                } else {
                    resultText = `❌ Sorry, could not identify the song from this ${media.type}.`;
                    debugLog('No song identified from Shazam API');
                }
            } catch (apiError) {
                console.error('[SHAZAM] API error:', apiError.message);
                debugLog('Shazam API error details:', {
                    code: apiError.code,
                    response: apiError.response?.data,
                    status: apiError.response?.status
                });

                if (apiError.code === 'ECONNREFUSED') {
                    resultText = `❌ Shazam service is currently unavailable. Please try again later.`;
                } else if (apiError.response?.status === 404) {
                    resultText = `❌ Song not found. Try with a clearer audio sample.`;
                } else {
                    resultText = `❌ Failed to recognize the song from this ${media.type}.`;
                }
            }

            debugLog('Sending result to user...');
            await sock.sendMessage(chatId, { text: resultText }, { quoted: msg });

        } catch (error) {
            console.error('[SHAZAM] General error:', error.message);
            debugLog('General error details:', { stack: error.stack });

            await sock.sendMessage(chatId, {
                text: `❌ Failed to process media for recognition: ${error.message}`
            }, { quoted: msg });
        } finally {
            if (tempPath && fs.existsSync(tempPath)) {
                try {
                    fs.unlinkSync(tempPath);
                    debugLog('Temp file cleaned up');
                } catch (cleanupError) {
                    console.error('[SHAZAM] Cleanup error:', cleanupError.message);
                }
            }
        }
    }
};
