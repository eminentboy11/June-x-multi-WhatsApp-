/**
 * Shazam Command — Identify songs from audio / video media.
 * Upload: uguu.se only (buffer-based, no temp files).
 * API:    apiskeith.top/ai/shazam
 */

const axios = require("axios");
const FormData = require("form-data");
const { downloadMediaMessage } = require("@whiskeysockets/baileys");
const { sendButtons } = require("gifted-btns");

// ─── uguu.se upload ───────────────────────────────────────────────────────────
async function uploadToUguu(buffer, filename) {
    const form = new FormData();
    form.append("files[]", buffer, { filename });

    const res = await axios.post("https://uguu.se/upload.php", form, {
        headers: form.getHeaders(),
        timeout: 30000,
    });

    const url = res.data?.files?.[0]?.url;
    if (!url)
        throw new Error(
            "uguu.se returned no URL — response: " + JSON.stringify(res.data),
        );
    return url;
}

// ─── resolve quoted or direct media ──────────────────────────────────────────
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

function getMediaType(msgObj) {
    const m = msgObj?.message || {};
    if (m.audioMessage) return { type: "audio", ext: "mp3" };
    if (m.videoMessage) return { type: "video", ext: "mp4" };
    return null;
}

// ─── Command ──────────────────────────────────────────────────────────────────
module.exports = {
    name: "shazam",
    aliases: ["whatsong", "identify", "songtag"],
    category: "media",
    description: "Identify a song from audio or video",
    usage: ".shazam — reply to or send an audio / video message",

    async execute(sock, msg, args, extra) {
        const from = extra.from;

        // Find the media — direct message first, then quoted
        let targetMsg = msg;
        let mediaInfo = getMediaType(msg);

        if (!mediaInfo) {
            const quoted = resolveQuotedMsg(msg);
            if (quoted) {
                mediaInfo = getMediaType(quoted);
                if (mediaInfo) targetMsg = quoted;
            }
        }

        if (!mediaInfo) {
            return extra.reply(
                `🎵 *Shazam — Song Identifier*\n\n` +
                    `❌ Please *send* or *reply to* an audio or video message.\n\n` +
                    `*Supported:*\n` +
                    `• Voice notes / audio files\n` +
                    `• Videos with audio`,
            );
        }

        await sock.sendMessage(from, { react: { text: "🎵", key: msg.key } });

        try {
            // ── Download ────────────────────────────────────────────────────
            const buffer = await downloadMediaMessage(
                targetMsg,
                "buffer",
                {},
                { logger: undefined, reuploadRequest: sock.updateMediaMessage },
            );
            if (!buffer || buffer.length === 0)
                throw new Error("Failed to download media");

            // ── Upload to uguu.se ───────────────────────────────────────────
            const filename = `shazam_${Date.now()}.${mediaInfo.ext}`;
            const mediaUrl = await uploadToUguu(buffer, filename);

            // ── Call Shazam API ─────────────────────────────────────────────
            const apiRes = await axios.get("https://apiskeith.top/ai/shazam", {
                params: { url: mediaUrl },
                timeout: 30000,
            });

            const song = apiRes.data?.result || apiRes.data;

            if (!song || (!song.title && !song.artists)) {
                await sock.sendMessage(from, {
                    react: { text: "❌", key: msg.key },
                });
                return extra.reply(
                    `❌ Could not identify the song. Try with a clearer audio sample.`,
                );
            }

            const title = song.title || "Unknown";
            const artist = song.artists || "Unknown";
            const album = song.album || "N/A";
            const release = song.release_date || "N/A";

            const reply =
                `🎶 *Song Identified!*\n\n` +
                `📝 *Title:*    ${title}\n` +
                `🎤 *Artist:*   ${artist}\n` +
                `💿 *Album:*    ${album}\n` +
                `📅 *Released:* ${release}`;

            const ytQuery = encodeURIComponent(`${title} ${artist}`);
            const ytUrl = `https://www.youtube.com/results?search_query=${ytQuery}`;
            const spotUrl = `https://open.spotify.com/search/${ytQuery}`;

            await sock.sendMessage(from, {
                react: { text: "✅", key: msg.key },
            });

            try {
                await sendButtons(
                    sock,
                    from,
                    {
                        text: reply,
                        footer: "🎵 Powered by Shazam",
                        buttons: [
                            {
                                name: "cta_url",
                                buttonParamsJson: JSON.stringify({
                                    display_text: "⬇️ Download / YouTube",
                                    url: ytUrl,
                                }),
                            },
                            {
                                name: "cta_url",
                                buttonParamsJson: JSON.stringify({
                                    display_text: "💚 Open on Spotify",
                                    url: spotUrl,
                                }),
                            },
                        ],
                    },
                    { quoted: msg },
                );
            } catch (_) {
                // Fallback if buttons fail
                await sock.sendMessage(from, { text: reply }, { quoted: msg });
            }
        } catch (err) {
            console.error("[shazam] error:", err.message);
            await sock.sendMessage(from, {
                react: { text: "❌", key: msg.key },
            });

            let errMsg = "Failed to identify the song.";
            if (
                err.message?.includes("uguu") ||
                err.message?.includes("upload")
            ) {
                errMsg = "Failed to upload media. Try again in a moment.";
            } else if (
                err.code === "ECONNABORTED" ||
                err.message?.includes("timeout")
            ) {
                errMsg = "Request timed out. Try a shorter clip.";
            } else if (err.response?.status === 404) {
                errMsg = "Song not found in Shazam database.";
            } else if (err.response?.status >= 500) {
                errMsg = "Shazam service is temporarily unavailable.";
            }

            await extra.reply(`❌ *Shazam Error*\n\n${errMsg}`);
        }
    },
};
