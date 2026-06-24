const axios  = require('axios');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const config = require('../../config');


module.exports = {
    name: 'xvideo',
    aliases: ['adult', 'xvdl', 'xmp4'],
    category: 'media',
    description: 'Download a xvideo and send as MP4',
    usage: '.xvdl <xvidurl or search>',
    ownerOnly: false,

    async execute(sock, msg, args, extra) {
        const chatId = extra.from;
        const query  = args.join(' ').trim();

        if (!query) return extra.reply(`Usage: ${config.prefix || '.'}xvdl < url or search>`);

        await sock.sendMessage(chatId, { react: { text: '⏳', key: msg.key } });

        let filePath;

        try {
            const apiSearchUrl = `https://ravenn.site/search/xvideos?q=${encodeURIComponent(query)}`;
            const { data: searchRes } = await axios.get(apiSearchUrl, { timeout: 30000 });

            const videoUrl = searchRes?.result?.url?;
            if (!video) throw new Error('No results found');


            const apiDownloadUrl = `https://ravenn.site/download/xvideos?url=${encodeURIComponent(videoUrl)}`;
            const { data: apiRes } = await axios.get(apiDownloadUrl, { timeout: 30000 });

            const downloadUrl = apiRes?.result?.download_url;
            if (!downloadUrl) throw new Error('API did not return a download URL');

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

            await sock.sendMessage(chatId, {
                video: fs.readFileSync(filePath),
                mimetype: 'video/mp4',
                caption: `🎬 ${safeTitle}`,
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
