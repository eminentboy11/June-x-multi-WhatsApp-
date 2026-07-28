/**
 * Shazam Command — Identify songs from audio / video media.
 * Supports: multi-API fallback (AudD → Keith → Ryzen) + text search.
 * Audio clip extracted via ffmpeg before identification.
 * Includes ▶️ Play button to download the identified song as audio.
 */

const axios = require("axios");
const FormData = require("form-data");
const { downloadMediaMessage } = require("@whiskeysockets/baileys");
const { sendButtons } = require("gifted-btns");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { exec } = require("child_process");
const { promisify } = require("util");
const yts = require("yt-search");

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

// ─── YouTube search + audio download (same chain as play.js) ─────────────────
async function searchYouTube(query) {
    const result = await yts(`${query} official audio`);
    if (!result?.videos?.length) throw new Error("No YouTube results found");
    return result.videos[0];
}

async function downloadAudio(videoUrl) {
    try {
        // Primary API
        const primary = await axios.get(
            `https://apiskeith2-production-ec66.up.railway.app/download/audio?url=${encodeURIComponent(videoUrl)}`,
            { timeout: 60000 },
        );
        if (primary.data?.status && primary.data?.result) {
            return { result: primary.data.result, title: primary.data.title };
        }
        throw new Error("Primary API failed");
    } catch {
        // Fallback API
        const fallback = await axios.get(
            `https://yt-dl.officialhectormanuel.workers.dev/?url=${encodeURIComponent(videoUrl)}`,
            { timeout: 60000 },
        );
        if (!fallback.data?.status || !fallback.data?.audio) {
            throw new Error("Both download APIs failed");
        }
        return { result: fallback.data.audio, title: fallback.data.title };
    }
}

// ─── Command ──────────────────────────────────────────────────────────────────
module.exports = {
    name: "shazam",
    aliases: ["whatsong", "findsong", "identify", "musicid"],
    category: "media",
    description: "Identify a song from audio. Reply to audio/voice note or search by name.",
    usage: ".shazam — reply to audio  |  .shazam <song name> — text search",

    async execute(sock, msg, args, extra) {
        const from = extra.from;

        // ── Text search mode ──────────────────────────────────────────────────
        if (args.length > 0) {
            const searchQuery = args.join(" ");
            await sock.sendMessage(from, { react: { text: "🔍", key: msg.key } });

            try {
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
            const dateNow   = Date.now();
            const ytQuery   = encodeURIComponent(`${songInfo.title} ${songInfo.artist}`);
            const ytUrl     = `https://www.youtube.com/results?search_query=${ytQuery}`;
            const spotUrl   = songInfo.spotify || `https://open.spotify.com/search/${ytQuery}`;
            const appleUrl  = songInfo.appleMusic || "";
            const songUrl   = songInfo.songLink || "";

            // URL buttons (open external links)
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

            // Play button — reply button that triggers download
            const playBtnId = `shazam_play_${dateNow}`;
            const playButton = { id: playBtnId, text: "▶️ Play" };

            // Send URL buttons (links)
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
                // Fallback: plain text with links
                let plain = resultText;
                if (songInfo.spotify)    plain += `\n🟢 *Spotify:*      ${songInfo.spotify}`;
                if (songInfo.appleMusic) plain += `\n🍎 *Apple Music:*  ${songInfo.appleMusic}`;
                if (songInfo.songLink)   plain += `\n🔗 *Link:*         ${songInfo.songLink}`;
                await sock.sendMessage(from, { text: plain }, { quoted: msg });
            }

            // Send the ▶️ Play download button as a separate interactive message
            try {
                await sendButtons(
                    sock,
                    from,
                    {
                        text: `🎵 *${songInfo.title}* — ${songInfo.artist}\n\nTap *▶️ Play* to download this song as audio.`,
                        footer: "🎵 Shazam",
                        buttons: [playButton],
                    },
                    { quoted: msg },
                );
            } catch (_) {
                // Fallback: tell user to use .play command
                await sock.sendMessage(from, {
                    text: `▶️ *To download:* \`.play ${songInfo.title} ${songInfo.artist}\``,
                }, { quoted: msg });
            }

            // ── Listen for Play button tap ────────────────────────────────────
            const originalSender = msg.key.participant || msg.key.remoteJid;

            const handlePlayTap = async (event) => {
                const m = event.messages?.[0];
                if (!m?.message) return;

                // Extract button response id from all known formats
                const selectedId =
                    m.message?.buttonsResponseMessage?.selectedButtonId ||
                    m.message?.templateButtonReplyMessage?.selectedId ||
                    (() => {
                        try {
                            const p = m.message?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
                            return p ? JSON.parse(p).id : null;
                        } catch { return null; }
                    })();

                if (!selectedId || selectedId !== playBtnId) return;
                if (m.key?.remoteJid !== from) return;

                // In groups: only the original requester can tap
                if (from.endsWith("@g.us")) {
                    const tapper = m.key.participant || m.key.remoteJid;
                    if (tapper !== originalSender) return;
                }

                // Remove listener — one download per result
                sock.ev.off("messages.upsert", handlePlayTap);

                await sock.sendMessage(from, { react: { text: "⬇️", key: msg.key } });

                let filePath;
                try {
                    // Search YouTube for the song
                    const searchTerm = `${songInfo.title} ${songInfo.artist}`;
                    const video = await searchYouTube(searchTerm);

                    await sock.sendMessage(from, {
                        text: `🎵 Downloading *${video.title}*…`,
                    }, { quoted: m });

                    // Download audio
                    const apiData = await downloadAudio(video.url);

                    filePath = path.join(os.tmpdir(), `shazam_play_${dateNow}.mp3`);
                    const audioStream = await axios({
                        method: "get",
                        url: apiData.result,
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

                    // Send as playable audio
                    await sock.sendMessage(from, {
                        audio: fs.readFileSync(filePath),
                        mimetype: "audio/mpeg",
                    }, { quoted: m });

                    await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });

                } catch (err) {
                    console.error("[SHAZAM play]", err.message);
                    await sock.sendMessage(from, { react: { text: "❌", key: msg.key } });
                    await sock.sendMessage(from, {
                        text: `❌ Download failed: ${err.message}\n\n_Try: \`.play ${songInfo.title} ${songInfo.artist}\`_`,
                    }, { quoted: m });
                } finally {
                    if (filePath && fs.existsSync(filePath)) {
                        try { fs.unlinkSync(filePath); } catch {}
                    }
                }
            };

            sock.ev.on("messages.upsert", handlePlayTap);

            // Auto-remove listener after 10 minutes to avoid memory leak
            setTimeout(() => {
                sock.ev.off("messages.upsert", handlePlayTap);
            }, 10 * 60 * 1000);

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
