const axios  = require('axios');
const yts    = require('yt-search');
const config = require('../../config');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');

module.exports = {
    name: 'video3',
    aliases: ['vid3', 'ytv3', 'mp4doc'],
    category: 'media',
    description: 'Download a YouTube video and send as document (MP4)',
    usage: '.video3 <youtube url or search>',
    ownerOnly: false,

    async execute(sock, msg, args, extra) {
        const chatId = extra.from;
        const query  = args.join(' ').trim();

        if (!query) {
            return extra.reply(`Usage: ${config.prefix || '.'}video3 <youtube url or search>`);
        }

        await extra.react('⏳');

        let filePath;

        try {
            // ── Step 1: resolve video via yt-search ──────────────────────
            const search = await yts(query);
            const video  = search?.videos?.[0];
            if (!video) throw new Error('No results found for that query');

            const { title, url: videoUrl } = video;

            // ── Step 2: fetch download URL from API ──────────────────────
            const apiUrl = `https://api.drexapp.space/downloader/ytmp4v1?url=${encodeURIComponent(videoUrl)}&quality=best`;

            const { data: apiRes } = await axios.get(apiUrl, { timeout: 30_000 });

            const downloadUrl = apiRes?.result?.download_url;
            if (!downloadUrl) throw new Error('API did not return a download URL');

            // ── Step 3: stream MP4 to temp file ──────────────────────────
            filePath = path.join(os.tmpdir(), `video3-${Date.now()}.mp4`);

            const { data: stream } = await axios.get(downloadUrl, {
                responseType: 'stream',
                timeout:      180_000,
                maxRedirects: 5,
            });

            await new Promise((resolve, reject) => {
                const writer = fs.createWriteStream(filePath);
                stream.pipe(writer);
                writer.on('finish', resolve);
                writer.on('error', reject);
                stream.on('error', reject);
            });

            const stat = fs.statSync(filePath);
            if (!stat || stat.size === 0) throw new Error('Download failed — file is empty');

            // ── Step 4: send as document ──────────────────────────────────
            const safeTitle = title.replace(/[<>:"/\\|?*]/g, '').trim().slice(0, 80);

            await sock.sendMessage(
                chatId,
                {
                    document: fs.readFileSync(filePath),
                    mimetype: 'video/mp4',
                    fileName: `${safeTitle}.mp4`,
                },
                { quoted: msg }
            );

            await extra.react('✅');

        } catch (err) {
            console.error('[video3]', err.message);
            await extra.react('❌');
            await extra.reply(`❌ ${err.message}`);
        } finally {
            try {
                if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
            } catch { /* ignore cleanup errors */ }
        }
    },
};
