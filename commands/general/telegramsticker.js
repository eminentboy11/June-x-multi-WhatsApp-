/**
 * Telegram Sticker Pack → WhatsApp Stickers
 * Downloads every sticker from a Telegram pack and sends them as WA stickers.
 *
 * Commands: .tgs | .telegramsticker | .tgms
 * Usage:    .tgs https://t.me/addstickers/<PackName>
 */

const fetch      = require('node-fetch');
const fs         = require('fs');
const path       = require('path');
const crypto     = require('crypto');
const { spawn }  = require('child_process');
const webp       = require('node-webpmux');
const ffmpegPath = require('ffmpeg-static');
const config     = require('../../config');
const { getTempDir, deleteTempFile } = require('../../utils/tempManager');

// Telegram Bot Token — set config.telegramToken in config.js to override
const TG_TOKEN = config.telegramToken || '7801479976:AAGuPL0a7kXXBYz6XUSR_ll2SR5V_W6oHl4';

const delay = ms => new Promise(r => setTimeout(r, ms));

/** Download a URL to a Buffer via node-fetch */
async function fetchBuffer(url) {
    const res = await fetch(url, { headers: { 'User-Agent': 'JuneXUltra/2.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.buffer();
}

/** Convert any image/animation to webp using ffmpeg-static */
async function toWebp(inputPath, outputPath, isAnimated) {
    const args = isAnimated
        ? [
            '-y', '-i', inputPath,
            '-vf', 'scale=512:-1:force_original_aspect_ratio=decrease,fps=15,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000',
            '-c:v', 'libwebp', '-lossless', '0', '-q:v', '60',
            '-loop', '0', '-vsync', '0', '-pix_fmt', 'yuva420p',
            outputPath
          ]
        : [
            '-y', '-i', inputPath,
            '-vf', 'scale=512:-1:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000',
            '-c:v', 'libwebp', '-lossless', '0', '-q:v', '75',
            outputPath
          ];

    await new Promise((resolve, reject) => {
        const ff = spawn(ffmpegPath, args);
        const errs = [];
        ff.stderr.on('data', d => errs.push(d));
        ff.on('error', reject);
        ff.on('close', code =>
            code === 0 ? resolve() : reject(new Error(Buffer.concat(errs).toString().slice(-200)))
        );
    });
}

/** Embed EXIF sticker metadata into a WebP buffer */
async function embedExif(webpBuffer, packName, emoji) {
    const img = new webp.Image();
    await img.load(webpBuffer);

    const json = {
        'sticker-pack-id':   crypto.randomBytes(32).toString('hex'),
        'sticker-pack-name': packName,
        emojis:              emoji ? [emoji] : ['🤖'],
    };

    const exifAttr = Buffer.from([
        0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00,
        0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
    ]);
    const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
    const exif    = Buffer.concat([exifAttr, jsonBuf]);
    exif.writeUIntLE(jsonBuf.length, 14, 4);

    img.exif = exif;
    return img.save(null);
}

module.exports = {
    name:        'telegramsticker',
    aliases:     ['tgs', 'tgms', 'tgsticker'],
    category:    'general',
    description: 'Download a Telegram sticker pack and send all stickers to WhatsApp',
    usage:       '.tgs https://t.me/addstickers/<PackName>',

    async execute(sock, msg, args, extra) {
        const { from, reply } = extra;

        // ── Validate input ───────────────────────────────────────────────
        const url = args[0] || '';
        if (!url) {
            return reply(
                `📦 *Telegram Sticker Pack*\n` +
                `━━━━━━━━━━━━━━━\n` +
                `Send an entire Telegram sticker pack as WhatsApp stickers.\n\n` +
                `*Usage:*\n  .tgs https://t.me/addstickers/PackName\n\n` +
                `*Example:*\n  .tgs https://t.me/addstickers/Porcientoreal`
            );
        }

        if (!url.match(/https:\/\/t\.me\/addstickers\//i)) {
            return reply(
                `❌ Invalid URL.\n` +
                `Use a Telegram sticker pack link:\n` +
                `_https://t.me/addstickers/PackName_`
            );
        }

        const packName = url.replace(/https:\/\/t\.me\/addstickers\//i, '').split('/')[0].trim();

        // ── Fetch pack metadata ──────────────────────────────────────────
        let stickerSet;
        try {
            const res  = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/getStickerSet?name=${encodeURIComponent(packName)}`);
            const data = await res.json();
            if (!data.ok) throw new Error(data.description || 'Unknown error');
            stickerSet = data.result;
        } catch (e) {
            return reply(`❌ Could not fetch sticker pack.\n${e.message}\n\nMake sure the pack link is correct.`);
        }

        const total    = stickerSet.stickers.length;
        const packLabel = stickerSet.title || packName;

        // Send + capture initial status message for in-place edits
        const sent = await sock.sendMessage(
            from,
            { text: `📦 *${packLabel}*\n🎯 Found *${total}* stickers\n⏳ _Starting download…_` },
            { quoted: msg }
        );
        const statusKey = sent?.key;

        const editStatus = async (text) => {
            if (!statusKey) return;
            try { await sock.sendMessage(from, { edit: statusKey, text }); } catch (_) {}
        };

        const tmpDir = getTempDir();
        let success  = 0;
        let failed   = 0;

        // ── Process each sticker ─────────────────────────────────────────
        for (let i = 0; i < total; i++) {
            const sticker    = stickerSet.stickers[i];
            const inputPath  = path.join(tmpDir, `tg_in_${Date.now()}_${i}`);
            const outputPath = path.join(tmpDir, `tg_out_${Date.now()}_${i}.webp`);

            try {
                // Update status every 5 stickers or on the first one
                if (i === 0 || i % 5 === 0) {
                    await editStatus(
                        `📦 *${packLabel}*\n` +
                        `⬇️ Downloading sticker *${i + 1}/${total}*\n` +
                        `✅ Sent: ${success}  ❌ Failed: ${failed}`
                    );
                }

                // Get file path from Telegram
                const fileRes  = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/getFile?file_id=${sticker.file_id}`);
                const fileData = await fileRes.json();
                if (!fileData.ok) throw new Error('getFile failed');

                const fileUrl = `https://api.telegram.org/file/bot${TG_TOKEN}/${fileData.result.file_path}`;
                const buf     = await fetchBuffer(fileUrl);
                fs.writeFileSync(inputPath, buf);

                const isAnimated = !!(sticker.is_animated || sticker.is_video);

                // If already webp and not animated, use directly; otherwise convert
                const filePath    = fileData.result.file_path || '';
                const alreadyWebp = filePath.endsWith('.webp') && !isAnimated;

                let webpBuf;
                if (alreadyWebp) {
                    webpBuf = buf;
                } else {
                    await toWebp(inputPath, outputPath, isAnimated);
                    webpBuf = fs.readFileSync(outputPath);
                }

                const finalBuf = await embedExif(webpBuf, config.packname || config.botName || 'June X Ultra', sticker.emoji);

                await sock.sendMessage(from, { sticker: finalBuf });
                success++;

                await delay(600);
            } catch (err) {
                console.error(`[TGS] Sticker ${i + 1} failed:`, err.message);
                failed++;
            } finally {
                try { deleteTempFile(inputPath);  } catch (_) {}
                try { deleteTempFile(outputPath); } catch (_) {}
            }
        }

        // ── Final status ─────────────────────────────────────────────────
        await editStatus(
            `✅ *${packLabel}* — Done!\n` +
            `📊 Sent: *${success}/${total}*` +
            (failed ? `  ❌ Failed: ${failed}` : '') +
            `\n\n> Powered by ${config.botName}`
        );
    }
};
