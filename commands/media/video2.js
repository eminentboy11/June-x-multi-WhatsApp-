/**
 * YTMP4 Command — supports YouTube URL or search query
 */

const yts = require('yt-search');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { sendButtons } = require('gifted-btns');
const config = require('../../config');

function isYouTubeUrl(str) {
    return /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(str);
}

async function searchYouTube(query) {
    const res = await yts(query);
    if (!res?.videos?.length) throw new Error('No results found');
    return res.videos[0];
}

async function downloadVideo(url) {
    try {
        const r = await axios.get(`https://ravenn.site/download/video?url=${encodeURIComponent(url)}`, { timeout: 60000 });
        if (r.data?.status && r.data?.result) return r.data;
        throw new Error('Primary API failed');
    } catch {
        const fb = await axios.get(`https://iamtkm.vercel.app/downloaders/ytmp4?apikey=tkm&url=${encodeURIComponent(url)}`, { timeout: 60000 });
        if (!fb.data?.data?.url) throw new Error('Fallback API failed');
        return { status: true, result: fb.data.data.url, title: fb.data.data.title };
    }
}

function getButtons(id, tag) {
    const p = config.prefix || '.';
    return [
        { id: `${p}video_${id}_${tag}`, text: '🎬 Video' },
        { id: `${p}videodoc_${id}_${tag}`, text: '📄 Video Document' },
    ];
}

function extractButtonId(msg) {
    return (
        msg.message?.buttonsResponseMessage?.selectedButtonId ||
        msg.message?.templateButtonReplyMessage?.selectedId ||
        msg.message?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson ||
        ''
    );
}

module.exports = {
    name: 'ytmp42',
    aliases: ['video2', 'ytvideo2'],
    category: 'media',
    description: 'Download YouTube videos as MP4',
    usage: '.ytmp4 <video name | YouTube URL>',

    async execute(sock, msg, args, extra) {
        let query = args.join(' ').trim() || extra?.quoted?.conversation || '';
        if (!query) return extra.reply('🎬 Provide a video name or YouTube URL.');

        const from = extra.from;
        await sock.sendMessage(from, { react: { text: '🎥', key: msg.key } });

        let video;
        try {
            video = isYouTubeUrl(query)
                ? { url: query, title: 'YouTube Video', videoId: Date.now().toString(), author: { name: 'N/A' } }
                : await searchYouTube(query);
        } catch (e) {
            return extra.reply(`❌ Error: ${e.message}`);
        }

        const tag = Date.now(); // unique marker for this session
        await sendButtons(sock, from, {
            title: '🎬 VIDEO DOWNLOADER',
            text: `⿻ *Title:* ${video.title}\n⿻ *Channel:* ${video.author?.name}\n⿻ *Link:* ${video.url}\n\n*Select format:*`,
            footer: `Made by ${config.botName}`,
            buttons: getButtons(video.videoId, tag),
        }, { quoted: msg });

        // ✅ Persistent listener — no expiry, multi-tap allowed
        sock.ev.on('messages.upsert', async ev => {
            const m = ev.messages[0];
            if (!m?.message) return;
            const id = extractButtonId(m);
            if (!id.includes(`_${tag}`)) return; // only match current buttons
            if (m.key.remoteJid !== from) return; // only same chat

            await sock.sendMessage(from, { react: { text: '⬇️', key: msg.key } });
            try {
                const api = await downloadVideo(video.url);
                const file = path.join(__dirname, `temp_${tag}.mp4`);
                const stream = await axios({ url: api.result, method: 'get', responseType: 'stream' });
                const w = fs.createWriteStream(file);
                stream.data.pipe(w);
                await new Promise((r, j) => { w.on('finish', r); w.on('error', j); });

                const title = api.title || video.title;
                if (id.startsWith(`${config.prefix || '.'}video_`)) {
                    await sock.sendMessage(from, { video: { url: file }, mimetype: 'video/mp4', caption: `🎬 ${title}` }, { quoted: m });
                } else {
                    await sock.sendMessage(from, { document: { url: file }, mimetype: 'video/mp4', fileName: `${title}.mp4` }, { quoted: m });
                }
                fs.unlinkSync(file);
                await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });
            } catch (err) {
                await sock.sendMessage(from, { text: `🚫 Error: ${err.message}` }, { quoted: m });
            }
        });
    },
};
