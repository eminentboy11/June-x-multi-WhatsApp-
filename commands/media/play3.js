const { applyFont } = require('../../utils/fontConverter');
const axios  = require('axios');
const yts    = require('yt-search');
const config = require('../../config');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');

module.exports = {
    name: 'play3',
    aliases: ['song3', 'yt3', 'mp3doc'],
    category: 'media',
    description: 'Download a YouTube audio and send as document (MP3)',
    usage: '.play3 <youtube url or search>',
    ownerOnly: false,

    async execute(sock, msg, args, extra) {
        const chatId = extra.from;
        const query  = args.join(' ').trim();

        if (!query) return extra.reply(`Usage: ${config.prefix || '.'}play3 <youtube url or search>`);

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
            const apiUrl = `https://phantom-api.us.ci/api/download/youtube2?url=${encodeURIComponent(videoUrl)}&format=mp3`;
            const { data: apiRes } = await axios.get(apiUrl, { timeout: 30000 });

            const downloadUrl = apiRes?.url || apiRes?.download_url || apiRes?.link || apiRes?.data?.url || apiRes?.data?.download_url;
            if (!downloadUrl) throw new Error('API did not return a download URL');

            // ── Step 3: stream MP3 to temp file ───────────────────────────
            filePath = path.join(os.tmpdir(), `play3-${Date.now()}.mp3`);

            const stream = await axios({
                method:       'get',
                url:          downloadUrl,
                responseType: 'stream',
                timeout:      120000,
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
                mimetype: 'audio/mpeg',
                fileName: `${safeTitle}.mp3`,
            }, { quoted: msg });

            await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });

        } catch (err) {
            console.error('[Play3] error:', err.message);
            await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } });
            await extra.reply(`❌ ${err.message}`);
        } finally {
            if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
    }
};
