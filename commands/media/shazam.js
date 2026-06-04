/**
 * Shazam Command — Identify songs from audio / video media.
 * Supports: multi-API fallback (AudD → Keith → Ryzen) + text search.
 * Audio clip extracted via ffmpeg before identification.
 */

const axios = require("axios");
const FormData = require("form-data");
const { downloadMediaMessage } = require("@whiskeysockets/baileys");
const { sendButtons } = require("gifted-btns");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const { promisify } = require("util");

const execAsync = promisify(exec);

// ─── ffmpeg: extract 15s mono MP3 clip ───────────────────────────────────────
async function extractAudioClip(buffer, durationSec = 15) {
    const tmpDir = path.join(process.cwd(), "tmp", "shazam");
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const ts = Date.now();
    const inputPath = path.join(tmpDir, `shazam_in_${ts}.ogg`);
    const outputPath = path.join(tmpDir, `shazam_out_${ts}.mp3`);

    fs.writeFileSync(inputPath, buffer);

    try {
        await execAsync(
            `ffmpeg -v quiet -nostats -i "${inputPath}" -t ${durationSec} -ar 44100 -ac 1 -b:a 128k -y "${outputPath}"`,
            { timeout: 30000 },
        );
        const result = fs.readFileSync(outputPath);
        try { fs.unlinkSync(inputPath); } catch {}
        try { fs.unlinkSync(outputPath); } catch {}
        return result;
    } catch {
        try { fs.unlinkSync(inputPath); } catch {}
        return buffer;
    }
}

// ─── multi-API song identification ───────────────────────────────────────────
async function identifySong(audioBuffer) {
    const identifyApis = [
        {
            name: "AudD",
            identify: async (buf) => {
                const base64 = buf.toString("base64");
                const res = await axios.post(
                    "https://api.audd.io/",
                    {
                        audio: base64,
                        return: "apple_music,spotify",
                        api_token: "test",
                    },
                    { timeout: 30000 },
                );
                if (res.data?.status === "success" && res.data?.result) {
                    const r = res.data.result;
                    return {
                        title: r.title || "Unknown",
                        artist: r.artist || "Unknown",
                        album: r.album || "",
                        releaseDate: r.release_date || "",
                        label: r.label || "",
                        timecode: r.timecode || "",
                        songLink: r.song_link || "",
                        spotify: r.spotify?.external_urls?.spotify || "",
                        appleMusic: r.apple_music?.url || "",
                    };
                }
                return null;
            },
        },
        {
            name: "Keith Shazam",
            identify: async (buf) => {
                const form = new FormData();
                form.append("file", buf, {
                    filename: "audio.mp3",
                    contentType: "audio/mpeg",
                });
                const res = await axios.post(
                    "https://apiskeith.vercel.app/ai/shazam",
                    form,
                    { headers: form.getHeaders(), timeout: 30000 },
                );
                const r = res.data?.result || res.data;
                if (r && (r.title || r.track)) {
                    return {
                        title: r.title || r.track?.title || "Unknown",
                        artist: r.artist || r.track?.subtitle || "Unknown",
                        album:
                            r.album ||
                            r.track?.sections?.[0]?.metadata?.[0]?.text ||
                            "",
                        releaseDate: r.release_date || "",
                        label: r.label || "",
                        songLink: r.url || r.track?.url || "",
                        spotify: "",
                        appleMusic: "",
                    };
                }
                return null;
            },
        },
        {
            name: "Ryzen Shazam",
            identify: async (buf) => {
                const form = new FormData();
                form.append("file", buf, {
                    filename: "audio.mp3",
                    contentType: "audio/mpeg",
                });
                const res = await axios.post(
                    "https://api.ryzendesu.vip/api/ai/shazam",
                    form,
                    { headers: form.getHeaders(), timeout: 30000 },
                );
                const r = res.data?.result || res.data;
                if (r && (r.title || r.track)) {
                    return {
                        title: r.title || r.track?.title || "Unknown",
                        artist: r.artist || r.track?.subtitle || "Unknown",
                        album: r.album || "",
                        releaseDate: "",
                        label: "",
                        songLink: r.url || "",
                        spotify: "",
                        appleMusic: "",
                    };
                }
                return null;
            },
        },
    ];

    for (const api of identifyApis) {
        try {
            const result = await api.identify(audioBuffer);
            if (result) {
                console.log(`[SHAZAM] Identified via ${api.name}`);
                return result;
            }
        } catch (err) {
            console.log(`[SHAZAM] ${api.name} failed: ${err.message}`);
        }
    }

    return null;
}

// ─── resolve quoted media ─────────────────────────────────────────────────────
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
    if (m.audioMessage) return { type: "audio", ext: "ogg" };
    if (m.videoMessage) return { type: "video", ext: "mp4" };
    return null;
}

// ─── Command ──────────────────────────────────────────────────────────────────
module.exports = {
    name: "shazam",
    aliases: ["whatsong", "findsong", "identify", "musicid"],
    category: "Search",
    description: "Identify a song from audio. Reply to audio/voice note or search by name.",
    usage: ".shazam — reply to audio  |  .shazam <song name> — text search",

    async execute(sock, msg, args, extra) {
        const from = extra.from;

        // ── Text search mode ──────────────────────────────────────────────────
        if (args.length > 0) {
            const searchQuery = args.join(" ");
            await sock.sendMessage(from, { react: { text: "🔍", key: msg.key } });

            try {
                const yts = require("yt-search");
                const results = await yts(searchQuery);

                if (!results?.videos?.length) {
                    return extra.reply(`❌ No results found for *"${searchQuery}"*`);
                }

                const top = results.videos.slice(0, 5);
                let text = `🎵 *Search Results for:* "${searchQuery}"\n\n`;
                top.forEach((v, i) => {
                    text += `${i + 1}. *${v.title}*\n`;
                    text += `   👤 ${v.author.name}\n`;
                    text += `   ⏱️ ${v.timestamp} | 👁️ ${v.views?.toLocaleString() || "N/A"}\n`;
                    text += `   🔗 ${v.url}\n\n`;
                });

                await sock.sendMessage(from, { text }, { quoted: msg });
                await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });
            } catch (err) {
                await sock.sendMessage(from, { react: { text: "❌", key: msg.key } });
                await extra.reply(`❌ Search failed: ${err.message}`);
            }
            return;
        }

        // ── Audio identification mode ─────────────────────────────────────────
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
                `🎵 *SHAZAM* \n` +
                `⏭️ *.shazam* Reply to audio/video to identify\n` +
                `⚡ *.shazam <song name>* Search by text\n` +
                `🌠 *🎵 Powered by SHAZAM*`,
            );
        }

        await sock.sendMessage(from, { react: { text: "⏳", key: msg.key } });

        try {
            // ── Download ──────────────────────────────────────────────────────
            const buffer = await downloadMediaMessage(
                targetMsg,
                "buffer",
                {},
                { logger: undefined, reuploadRequest: sock.updateMediaMessage },
            );
            if (!buffer || buffer.length === 0)
                throw new Error("Failed to download media");

            await sock.sendMessage(from, { react: { text: "📥", key: msg.key } });

            // ── Extract 15s clip via ffmpeg ───────────────────────────────────
            const clip = await extractAudioClip(buffer, 15);

            // ── Identify song ─────────────────────────────────────────────────
            const songInfo = await identifySong(clip);

            if (!songInfo) {
                await sock.sendMessage(from, { react: { text: "❌", key: msg.key } });
                return extra.reply(
                    `❌ *Song not identified*\n\n` +
                    `Could not recognize this audio.\n\n` +
                    `*Tips:*\n` +
                    `• Use clear audio (not distorted)\n` +
                    `• 10–15 seconds of the main melody\n` +
                    `• Avoid excessive background noise`,
                );
            }

            // ── Build result text ─────────────────────────────────────────────
            let resultText = `🎶 *Song Identified!*\n\n`;
            resultText += `📝 *Title:*    ${songInfo.title}\n`;
            resultText += `🎤 *Artist:*   ${songInfo.artist}\n`;
            if (songInfo.album)       resultText += `💿 *Album:*    ${songInfo.album}\n`;
            if (songInfo.releaseDate) resultText += `📅 *Released:* ${songInfo.releaseDate}\n`;
            if (songInfo.label)       resultText += `🏷️ *Label:*    ${songInfo.label}\n`;
            if (songInfo.timecode)    resultText += `⏱️ *Timecode:* ${songInfo.timecode}\n`;

            await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });
            console.log(`[SHAZAM] Identified: ${songInfo.artist} - ${songInfo.title}`);

            // ── Build buttons ─────────────────────────────────────────────────
            const ytQuery  = encodeURIComponent(`${songInfo.title} ${songInfo.artist}`);
            const ytUrl    = `https://www.youtube.com/results?search_query=${ytQuery}`;
            const spotUrl  = songInfo.spotify || `https://open.spotify.com/search/${ytQuery}`;
            const appleUrl = songInfo.appleMusic || "";
            const songUrl  = songInfo.songLink || "";

            const urlButtons = [
                {
                    name: "cta_url",
                    buttonParamsJson: JSON.stringify({
                        display_text: "▶️ YouTube Search",
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
            ];

            if (appleUrl) {
                urlButtons.push({
                    name: "cta_url",
                    buttonParamsJson: JSON.stringify({
                        display_text: "🍎 Apple Music",
                        url: appleUrl,
                    }),
                });
            }

            if (songUrl) {
                urlButtons.push({
                    name: "cta_url",
                    buttonParamsJson: JSON.stringify({
                        display_text: "🔗 Song Link",
                        url: songUrl,
                    }),
                });
            }

            try {
                await sendButtons(
                    sock,
                    from,
                    {
                        text: resultText,
                        footer: "🎵 Powered by Shazam",
                        buttons: urlButtons,
                    },
                    { quoted: msg },
                );
            } catch (_) {
                if (songInfo.spotify)    resultText += `\n🟢 *Spotify:*      ${songInfo.spotify}`;
                if (songInfo.appleMusic) resultText += `\n🍎 *Apple Music:*  ${songInfo.appleMusic}`;
                if (songInfo.songLink)   resultText += `\n🔗 *Link:*         ${songInfo.songLink}`;
                await sock.sendMessage(from, { text: resultText }, { quoted: msg });
            }

        } catch (err) {
            console.error("[SHAZAM] error:", err.message);
            await sock.sendMessage(from, { react: { text: "❌", key: msg.key } });

            let errMsg = "Failed to identify the song.";
            if (err.message?.includes("download") || err.message?.includes("media")) {
                errMsg = "Failed to download media. Try again in a moment.";
            } else if (err.code === "ECONNABORTED" || err.message?.includes("timeout")) {
                errMsg = "Request timed out. Try a shorter or clearer clip.";
            } else if (err.response?.status === 404) {
                errMsg = "Song not found in the Shazam database.";
            } else if (err.response?.status >= 500) {
                errMsg = "Shazam service is temporarily unavailable.";
            }

            await extra.reply(`❌ *Shazam Error*\n\n${errMsg}`);
        }
    },
};
