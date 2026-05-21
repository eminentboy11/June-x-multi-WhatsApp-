/**
 * Shazam Command — Identify songs via ACRCloud + Spotify download.
 * Identify: ACRCloud SDK (identify-eu-west-1.acrcloud.com)
 * Download: api.nexray.eu.cc/downloader/spotifyplay
 */

const { downloadContentFromMessage } = require("@whiskeysockets/baileys");
const { sendButtons } = require("gifted-btns");
const acrcloud = require("acrcloud");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// ─── ACRCloud setup ──────────────────────────────────────────────────────────
const acr = new acrcloud({
    host: "identify-eu-west-1.acrcloud.com",
    access_key: "2631ab98e77b49509e3edcf493757300",
    access_secret: "KKbVWlTNCL3JjxjrWnywMdvQGanyhKRN0fpQxyUo",
});

const RETRY_DELAY = 3000;
const PREFIX = "."; // fallback, can be overridden by config

// ─── Helper: download media buffer ───────────────────────────────────────────
async function downloadMedia(msgContent) {
    const types = ["audioMessage", "videoMessage"];
    for (const type of types) {
        if (msgContent[type]) {
            const mediaType = type === "audioMessage" ? "audio" : "video";
            const stream = await downloadContentFromMessage(msgContent[type], mediaType);
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            return Buffer.concat(chunks);
        }
    }
    return null;
}

// ─── Helper: retry logic for API calls ───────────────────────────────────────
async function withRetry(fn, retries = 3, delayMs = RETRY_DELAY) {
    let lastErr;
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (e) {
            lastErr = e;
            const isBusy = e.message?.toLowerCase().includes("busy") ||
                           e.message?.toLowerCase().includes("try again");
            if (i < retries - 1 && isBusy) {
                await new Promise(r => setTimeout(r, delayMs));
            } else if (!isBusy) {
                throw e;
            }
        }
    }
    throw lastErr;
}

// ─── Helper: download from Spotify API ───────────────────────────────────────
async function downloadSpotify(exactQuery) {
    return withRetry(async () => {
        const res = await axios.get(
            `https://api.nexray.eu.cc/downloader/spotifyplay?q=${encodeURIComponent(exactQuery)}`,
            { timeout: 90000 }
        );
        const result = res.data?.result;
        if (!res.data?.status || !result?.download_url) {
            throw new Error("Download API returned no URL");
        }
        return {
            downloadUrl: result.download_url,
            title: result.title || "",
            artist: result.artist || "",
        };
    });
}

// ─── Helper: extract button response ID ──────────────────────────────────────
function extractButtonResponseId(msg) {
    return (
        msg.message?.buttonsResponseMessage?.selectedButtonId ||
        msg.message?.templateButtonReplyMessage?.selectedId ||
        msg.message?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson ||
        null
    );
}

// ─── Helper: resolve quoted message ──────────────────────────────────────────
function resolveQuotedMsg(msg) {
    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    if (!ctx?.quotedMessage) return null;
    return {
        key: {
            remoteJid: msg.key.remoteJid,
            id: ctx.stanzaId,
            participant: ctx.participant,
        },
        message: ctx.quotedMessage,
    };
}

// ─── Helper: check if message contains media ─────────────────────────────────
function getMediaType(msgObj) {
    const m = msgObj?.message || {};
    if (m.audioMessage) return "audio";
    if (m.videoMessage) return "video";
    return null;
}

// ─── Command ──────────────────────────────────────────────────────────────────
module.exports = {
    name: "shazam",
    aliases: ["whatsong", "identify", "songtag"],
    category: "media",
    description: "Identify a song from audio or video",
    usage: ".shazam — reply to an audio / video message",

    async execute(sock, msg, args, extra) {
        const from = extra.from;

        // React instantly to show the bot is working
        await sock.sendMessage(from, { react: { text: "🎵", key: msg.key } });

        // Find the media — quoted message only (as in original)
        let targetMsg = null;
        let mediaType = null;

        const quoted = resolveQuotedMsg(msg);
        if (quoted) {
            mediaType = getMediaType(quoted);
            if (mediaType) targetMsg = quoted;
        }

        if (!targetMsg || !mediaType) {
            return extra.reply(
                `🎵 *Shazam — Song Identifier*\n\n` +
                `❌ Please *reply to* an audio or video message.\n\n` +
                `*Supported:*\n` +
                `• Voice notes / audio files\n` +
                `• Videos with audio`
            );
        }

        await extra.reply("🔍 Analyzing the media, please wait...");

        try {
            // ── 1. Download media buffer ────────────────────────────────────
            const buffer = await downloadMedia(targetMsg.message);
            if (!buffer || buffer.length === 0)
                throw new Error("Failed to download the media");

            // ── 2. Identify with ACRCloud ───────────────────────────────────
            const { status, metadata } = await acr.identify(buffer);
            if (status.code !== 0) {
                await sock.sendMessage(from, { react: { text: "❌", key: msg.key } });
                return extra.reply(`❌ Could not identify the song.\n\n📌 *Reason:* ${status.msg}`);
            }

            const song = metadata.music[0];
            const title = song.title || "Unknown";
            const artists = song.artists || [];
            const artistNames = artists.map(a => a.name).join(", ") || "Unknown";
            const album = song.album?.name || "N/A";
            const genres = song.genres?.map(g => g.name).join(", ") || "N/A";
            const release = song.release_date || "N/A";

            const resultText =
                `🎶 *SONG IDENTIFIED* 🎶\n\n` +
                `📝 *Title:* ${title}\n` +
                `🎤 *Artist(s):* ${artistNames}\n` +
                `💿 *Album:* ${album}\n` +
                `🎸 *Genre(s):* ${genres}\n` +
                `📅 *Released:* ${release}\n\n` +
                `*Select a format to download:*`;

            await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });

            // ── 3. Send result with download buttons ────────────────────────
            const dateNow = Date.now();
            const originalSender = msg.key.participant || msg.key.remoteJid;

            await sendButtons(
                sock,
                from,
                {
                    title: "🎵 SHAZAM RESULT",
                    text: resultText.trim(),
                    footer: `Made by ${extra.botName || "Shazam Bot"}`,
                    buttons: [
                        { id: `${PREFIX}shazamdl_audio_${dateNow}`, text: "🎶 Audio" },
                        { id: `${PREFIX}shazamdl_audiodoc_${dateNow}`, text: "📄 Audio Document" },
                    ],
                },
                { quoted: msg }
            );

            // ── 4. Listen for button selection (temporary) ──────────────────
            const handleDownload = async (event) => {
                const messageData = event.messages[0];
                if (!messageData?.message) return;

                const selectedId = extractButtonResponseId(messageData);
                if (!selectedId) return;
                if (!selectedId.includes("shazamdl_") || !selectedId.includes(`_${dateNow}`)) return;
                if (messageData.key?.remoteJid !== from) return;

                const responseSender = messageData.key?.participant || messageData.key?.remoteJid;
                if (from.endsWith("@g.us") && responseSender !== originalSender) return;

                // Stop listening after button is pressed
                sock.ev.off("messages.upsert", handleDownload);
                clearTimeout(dlTimer);

                await sock.sendMessage(from, { react: { text: "⬇️", key: msg.key } });

                try {
                    const formatType = selectedId.replace(PREFIX, "").split("_")[1]; // "audio" or "audiodoc"
                    const exactQuery = `${artistNames} - ${title}`;
                    const apiData = await downloadSpotify(exactQuery);

                    // Create temp directory if needed
                    const tempDir = path.join(__dirname, "temp");
                    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

                    const filePath = path.join(tempDir, `shazam_${dateNow}.mp3`);
                    const audioStream = await axios({
                        method: "get",
                        url: apiData.downloadUrl,
                        responseType: "stream",
                        timeout: 600000,
                    });

                    const writer = fs.createWriteStream(filePath);
                    audioStream.data.pipe(writer);
                    await new Promise((resolve, reject) => {
                        writer.on("finish", resolve);
                        writer.on("error", reject);
                    });

                    if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
                        throw new Error("Download failed — file is empty");
                    }

                    const rawTitle = apiData.title || title || "";
                    const cleanTitle = rawTitle.replace(/[^\w\s.-]/gi, "").substring(0, 100);

                    if (formatType === "audio") {
                        await sock.sendMessage(from, {
                            audio: { url: filePath },
                            mimetype: "audio/mpeg",
                        }, { quoted: messageData });
                    } else if (formatType === "audiodoc") {
                        await sock.sendMessage(from, {
                            document: { url: filePath },
                            mimetype: "audio/mpeg",
                            fileName: `${cleanTitle}.mp3`,
                            caption: `> ${extra.botName || "Shazam Bot"}`,
                        }, { quoted: messageData });
                    }

                    // Clean up temp file
                    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                    await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });

                } catch (dlErr) {
                    console.error("[shazam] download error:", dlErr.message);
                    await sock.sendMessage(from, { react: { text: "❌", key: msg.key } });
                    await sock.sendMessage(from, {
                        text: `🚫 Download failed: ${dlErr.message}\n\n_Try again later._`
                    }, { quoted: messageData });
                }
            };

            sock.ev.on("messages.upsert", handleDownload);
            const dlTimer = setTimeout(() => {
                sock.ev.off("messages.upsert", handleDownload);
            }, 120000);

        } catch (err) {
            console.error("[SHAZAM] Error:", err.message);
            await sock.sendMessage(from, { react: { text: "❌", key: msg.key } });

            let errMsg = "Something went wrong.";
            if (err.message?.includes("identify")) errMsg = "ACRCloud identification failed.";
            else if (err.message?.includes("download")) errMsg = "Failed to download the media.";
            else if (err.message?.includes("timeout")) errMsg = "Request timed out. Try a shorter clip.";

            await extra.reply(
                `❌ *Shazam Error*\n\n` +
                `🚫 ${errMsg}\n\n` +
                `💡 Tips:\n• Make sure the audio is clear\n• Try a shorter clip\n• Retry later`
            );
        }
    },
};
