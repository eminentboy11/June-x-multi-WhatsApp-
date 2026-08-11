const fetch      = require('node-fetch');
const fs         = require('fs');
const path       = require('path');
const crypto     = require('crypto');
const { spawn }  = require('child_process');
const webp       = require('node-webpmux');
const ffmpegPath = require('../../utils/ffmpegPath');
const config     = require('../../config');
const { getTempDir, deleteTempFile } = require('../../utils/tempManager');

const PACK_SIZE  = 59;
const TG_TOKEN   = '8773913673:AAGRx9OBJHP1u1mEOKa741Cmmz6woXgXSNY';
const delay = ms => new Promise(r => setTimeout(r, ms));

async function fetchBuffer(url) {
    const res = await fetch(url, { headers: { 'User-Agent': 'JuneXUltra/2.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.buffer();
}


async function toWebp(inputPath, outputPath, isAnimated) {
    const args = isAnimated
        ? [
            '-y', '-i', inputPath,
            '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,fps=15,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000',
            '-c:v', 'libwebp', '-lossless', '0', '-q:v', '60',
            '-loop', '0', '-vsync', '0', '-pix_fmt', 'yuva420p',
            '-an', '-t', '6',
            outputPath
          ]
        : [
            '-y', '-i', inputPath,
            '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000',
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

/**
 * Embed EXIF sticker metadata into a WebP buffer.
 * All stickers in the same WhatsApp pack MUST share the same packId.
 */
async function embedExif(webpBuffer, packId, packName, emoji) {
    const img = new webp.Image();
    await img.load(webpBuffer);

    const json = {
        'sticker-pack-id':   packId,
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
    description: 'Download a Telegram sticker pack and send as WhatsApp sticker pack(s) of 59',
    usage:       '.tgs https://t.me/addstickers/<PackName>',

    async execute(sock, msg, args, extra) {
        const { from, reply } = extra;

        const url = args[0] || '';
        if (!url) {
            return reply(
                `📦 *Telegram Sticker Pack*\n` +
                `━━━━━━━━━━━━━━━\n` +
                `Send an entire Telegram sticker pack as WhatsApp sticker packs (${PACK_SIZE} per pack).\n\n` +
                `*Usage:*\n  .tgs https://t.me/addstickers/PackName\n\n` +
                `*Example:*\n  .tgs https://t.me/addstickers/Porcientoreal`
            );
        }

        if (!url.match(/https?:\/\/t\.me\/addstickers\//i)) {
            return reply(
                `❌ Invalid URL.\n` +
                `Use a Telegram sticker pack link:\n` +
                `_https://t.me/addstickers/PackName_`
            );
        }

        const packName = url.replace(/https?:\/\/t\.me\/addstickers\//i, '').split('/')[0].trim();

        let stickerSet;
        try {
            const res  = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/getStickerSet?name=${encodeURIComponent(packName)}`);
            const data = await res.json();
            if (!data.ok) throw new Error(data.description || 'Unknown error');
            stickerSet = data.result;
        } catch (e) {
            return reply(`❌ Could not fetch sticker pack.\n${e.message}\n\nMake sure the pack link is correct.`);
        }

        const allStickers = stickerSet.stickers;
        const total       = allStickers.length;
        const packLabel   = stickerSet.title || packName;

        if (stickerSet.is_animated === true) {
            return reply(
                `❌ *${packLabel}* is a Lottie-animated pack (.tgs / vector JSON).\n` +
                `These can't be converted to WhatsApp stickers without extra dependencies.\n\n` +
                `Try a *static* or *video* pack instead.`
            );
        }

        // Split into chunks of PACK_SIZE
        const chunks = [];
        for (let i = 0; i < allStickers.length; i += PACK_SIZE) {
            chunks.push(allStickers.slice(i, i + PACK_SIZE));
        }
        const totalPacks = chunks.length;

        // Pre-generate one stable pack ID per chunk so every sticker in a
        // chunk shares the same ID and they group into one WhatsApp pack.
        const packIds   = chunks.map(() => crypto.randomBytes(32).toString('hex'));
        const waPack    = msg.pushName || 'User';

        const sent = await sock.sendMessage(
            from,
            {
                text:
                    `📦 *${packLabel}*\n` +
                    `🎯 *${total}* stickers → *${totalPacks}* pack${totalPacks > 1 ? 's' : ''} of up to ${PACK_SIZE}\n` +
                    `⏳ _Starting download…_`
            },
            { quoted: msg }
        );
        const statusKey = sent?.key;

        const editStatus = async (text) => {
            if (!statusKey) return;
            try { await sock.sendMessage(from, { edit: statusKey, text }); } catch (_) {}
        };

        const tmpDir  = getTempDir();
        let totalSent = 0;
        let failed    = 0;
        let skipped   = 0;

        for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
            const chunk   = chunks[chunkIdx];
            const packId  = packIds[chunkIdx];
            const packNum = chunkIdx + 1;
            // label embedded in EXIF — always the requester's pushName
            const label   = waPack;

            for (let i = 0; i < chunk.length; i++) {
                const globalIdx  = chunkIdx * PACK_SIZE + i;
                const sticker    = chunk[i];
                const inputPath  = path.join(tmpDir, `tg_in_${Date.now()}_${globalIdx}`);
                const outputPath = path.join(tmpDir, `tg_out_${Date.now()}_${globalIdx}.webp`);

                // Update status every 5 stickers
                if (globalIdx === 0 || globalIdx % 5 === 0) {
                    await editStatus(
                        `📦 *${packLabel}*\n` +
                        `🗂 Pack *${packNum}/${totalPacks}* — sticker *${globalIdx + 1}/${total}*\n` +
                        `✅ Sent: ${totalSent}  ⏭ Skipped: ${skipped}  ❌ Failed: ${failed}`
                    );
                }

                try {
                    // Skip Lottie-only stickers in otherwise mixed packs
                    if (sticker.is_animated && !sticker.is_video) {
                        skipped++;
                        continue;
                    }

                    const fileRes  = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/getFile?file_id=${sticker.file_id}`);
                    const fileData = await fileRes.json();
                    if (!fileData.ok) throw new Error('getFile failed');

                    const filePath    = fileData.result.file_path || '';
                    const fileUrl     = `https://api.telegram.org/file/bot${TG_TOKEN}/${filePath}`;
                    const buf         = await fetchBuffer(fileUrl);
                    fs.writeFileSync(inputPath, buf);

                    const isVideo     = !!sticker.is_video || filePath.endsWith('.webm');
                    const alreadyWebp = filePath.endsWith('.webp') && !isVideo;

                    let webpBuf;
                    if (alreadyWebp) {
                        webpBuf = buf;
                    } else {
                        await toWebp(inputPath, outputPath, isVideo);
                        webpBuf = fs.readFileSync(outputPath);
                    }

                    // All stickers in this chunk share the same packId → same WA pack
                    const finalBuf = await embedExif(webpBuf, packId, label, sticker.emoji);

                    await sock.sendMessage(from, { sticker: finalBuf });
                    totalSent++;

                    await delay(400);
                } catch (err) {
                    console.error(`[TGS] Sticker ${globalIdx + 1} failed:`, err.message);
                    failed++;
                } finally {
                    try { deleteTempFile(inputPath);  } catch (_) {}
                    try { deleteTempFile(outputPath); } catch (_) {}
                }
            }

            // Brief pause between packs
            if (chunkIdx < chunks.length - 1) await delay(1000);
        }

        await editStatus(
            `✅ *${packLabel}* — Done!\n` +
            `📊 Sent: *${totalSent}/${total}* across *${totalPacks}* pack${totalPacks > 1 ? 's' : ''}\n` +
            (skipped ? `⏭ Skipped (Lottie): ${skipped}\n` : '') +
            (failed  ? `❌ Failed: ${failed}\n`             : '') +
            `\n> Powered by ${config.botName || 'JuneX-Ultra'}`
        );
    }
};
