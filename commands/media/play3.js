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

        if (!query) return extra.reply(`Usage: ${config.prefix || '.'}play3 <song name>`);

        await sock.sendMessage(chatId, { react: { text: '⏳', key: msg.key } });

        let filePath;

        try {
            // ── Step 1: Search YouTube ────────────────────────────────────
            const search = await yts(query);
            const video  = search.videos[0];
            if (!video) throw new Error('No results found');

            // ── Step 2: Call API ──────────────────────────────────────────
            const { data: apiRes } = await axios.get(
                `https://api.cod3uchiha.com/downloaders/ytmp3?url=${encodeURIComponent(video.url)}&format=mp3`,
                { timeout: 30000 }
            );

            // result field holds the mp3 link
            const downloadUrl = apiRes?.data?.downloadUrl;
            if (!downloadUrl) throw new Error('No download URL returned');

            // ── Step 3: Download to temp file ─────────────────────────────
            filePath = path.join(os.tmpdir(), `play3-${Date.now()}.mp3`);
            const stream = await axios({ method: 'get', url: downloadUrl, responseType: 'stream', timeout: 120000 });
            const writer = fs.createWriteStream(filePath);
            stream.data.pipe(writer);
            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });

            if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
                throw new Error('Downloaded file is empty');
            }

            // ── Step 4: Send as MP3 document ──────────────────────────────
            const safeTitle = video.title.replace(/[<>:"/\\|?*]/g, '').trim().slice(0, 80);
            await sock.sendMessage(chatId, {
                document: fs.readFileSync(filePath),
                mimetype: 'audio/mpeg',
                fileName: `${safeTitle}.mp3`,
            }, { quoted: msg });

            await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });

        } catch (err) {
            console.error('[Play3]', err.message);
            await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } });
            await extra.reply(`❌ ${err.message}`);
        } finally {
            if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
    }
};
