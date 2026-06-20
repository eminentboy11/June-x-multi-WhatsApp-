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

        if (!query) return extra.reply(`Usage: ${config.prefix || '.'}video3 <youtube url or search>`);

        await sock.sendMessage(chatId, { react: { text: '⏳', key: msg.key } });

        let filePath;

        try {
            // ── Step 1: get title via yt-search ──────────────────────────
            const search = await yts(query);
            const video  = search.videos[0];
            if (!video) throw new Error('No results found');

            const title    = video.title;
            const videoUrl = video.url;

            // ── Step 2: call API ──────────────────────────────────────────
            const apiUrl = `https://phantom-api.us.ci/api/download/ytmp4?url=${encodeURIComponent(videoUrl)}&quality=best`;
            const { data: apiRes } = await axios.get(apiUrl, { timeout: 30000 });

            const downloadUrl = apiRes?.result?.download_url;
            if (!downloadUrl) throw new Error('API did not return a download URL');

            // ── Step 3: stream MP4 to temp file ──────────────────────────
            filePath = path.join(os.tmpdir(), `video3-${Date.now()}.mp4`);

            const stream = await axios({
                method:       'get',
                url:          downloadUrl,
                responseType: 'stream',
                timeout:      180000,
                maxRedirects: 5,
            });

            const writer = fs.createWriteStream(filePath);
            stream.data.pipe(writer);
            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });

            if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
                throw new Error('Download failed — file is empty');
            }

            const safeTitle = title.replace(/[<>:"/\\|?*]/g, '').trim().slice(0, 80);

            // ── Step 4: send as clean document ────────────────────────────
            await sock.sendMessage(chatId, {
                document: fs.readFileSync(filePath),
                mimetype: 'video/mp4',
                fileName: `${safeTitle}.mp4`,
            }, { quoted: msg });

            await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });

        } catch (err) {
            console.error('[Video3] error:', err.message);
            await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } });
            await extra.reply(`❌ ${err.message}`);
        } finally {
            if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
    }
};
