const axios  = require('axios');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const config = require('../../config');

module.exports = {
    name: 'xvideo',
    aliases: ['xadult', 'xvdl', 'xmp4'],
    category: 'media',
    description: 'Download a video and send as MP4',
    usage: '.vdl <url or search>',
    ownerOnly: false,

    async execute(sock, msg, args, extra) {
        const chatId = extra.from;
        const query  = args.join(' ').trim();

        if (!query) return extra.reply(`Usage: ${config.prefix || '.'}vdl <url or search>`);

        await sock.sendMessage(chatId, { react: { text: '⏳', key: msg.key } });

        let filePath;

        try {
            // ── Step 1: Search ────────────────────────────────────────────
            const { data: searchRes } = await axios.get(
                `https://ravenn.site/search/xvideos?q=${encodeURIComponent(query)}`,
                { timeout: 30000 }
            );

            const videoUrl = searchRes?.result?.url?.[0];
            if (!videoUrl) throw new Error('No results found');

            // ── Step 2: Download ──────────────────────────────────────────
            const { data: dlRes } = await axios.get(
                `https://ravenn.site/download/xvideos?url=${encodeURIComponent(videoUrl)}`,
                { timeout: 30000 }
            );

            const downloadUrl = dlRes?.result;
            if (!downloadUrl) throw new Error('No download URL returned');

            // ── Step 3: Stream to temp file ───────────────────────────────
            filePath = path.join(os.tmpdir(), `video-${Date.now()}.mp4`);
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
                throw new Error('Downloaded file is empty');
            }

            // ── Step 4: Send as MP4 ───────────────────────────────────────
            await sock.sendMessage(chatId, {
                video:    fs.readFileSync(filePath),
                mimetype: 'video/mp4',
                caption:  `🎬 ${query}`,
            }, { quoted: msg });

            await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });

        } catch (err) {
            console.error('[Video]', err.message);
            await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } });
            await extra.reply(`❌ ${err.message}`);
        } finally {
            if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
    }
};
