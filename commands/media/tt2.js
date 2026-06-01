// commands/tiktok.js
const axios = require('axios');

module.exports = {
  name: 'tiktok',
  aliases: ['tt', 'tiktokdl'],
  category: 'downloader',
  description: 'Download TikTok video (no watermark)',

  async execute(sock, msg, args, extra) {
    const { from } = extra;
    const url = args[0];

    if (!url || !url.includes('tiktok.com')) {
      return sock.sendMessage(from, {
        text: `◆ *TikTok Downloader* ◆\n\n◇ Usage: .tiktok <tiktok_url>\n◇ Example: .tiktok https://vm.tiktok.com/xxxxx`
      }, { quoted: msg });
    }

    await sock.sendMessage(from, {
      text: `◇ Fetching TikTok video, please wait...`
    }, { quoted: msg });

    try {
      // Primary API — tikwm.com
      let videoUrl = null;
      let audioUrl = null;
      let meta = {};

      try {
        const { data } = await axios.post(
          'https://www.tikwm.com/api/',
          new URLSearchParams({ url, hd: '1' }),
          { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        if (data?.code === 0 && data?.data?.play) {
          videoUrl = data.data.hdplay || data.data.play;
          audioUrl = data.data.music;
          meta = {
            title: data.data.title || 'TikTok Video',
            author: data.data.author?.nickname || 'Unknown',
            likes: data.data.digg_count || 0,
            views: data.data.play_count || 0,
            duration: data.data.duration || 0,
          };
        }
      } catch (_) {}

      // Fallback API — tiklydown
      if (!videoUrl) {
        const { data } = await axios.get(
          `https://api.tiklydown.eu.org/api/download?url=${encodeURIComponent(url)}`
        );

        if (data?.video?.noWatermark) {
          videoUrl = data.video.noWatermark;
          audioUrl = data.music?.play_url || null;
          meta = {
            title: data.title || 'TikTok Video',
            author: data.author?.name || 'Unknown',
            likes: data.stats?.likeCount || 0,
            views: data.stats?.playCount || 0,
            duration: data.video?.duration || 0,
          };
        }
      }

      if (!videoUrl) {
        return sock.sendMessage(from, {
          text: `◆ Failed to fetch video.\n◇ The link may be private or unsupported.`
        }, { quoted: msg });
      }

      // Download video buffer
      const videoRes = await axios.get(videoUrl, { responseType: 'arraybuffer' });
      const videoBuffer = Buffer.from(videoRes.data);

      const caption =
        `☆ *TikTok Downloader* ☆\n\n` +
        `◆ Title   : ${meta.title}\n` +
        `◆ Author  : ${meta.author}\n` +
        `◆ Likes   : ${Number(meta.likes).toLocaleString()}\n` +
        `◆ Views   : ${Number(meta.views).toLocaleString()}\n` +
        `◆ Duration: ${meta.duration}s\n\n` +
        `◇ No Watermark ◇`;

      await sock.sendMessage(from, {
        video: videoBuffer,
        caption,
        mimetype: 'video/mp4',
      }, { quoted: msg });

      // Optionally send audio too
      if (audioUrl) {
        try {
          const audioRes = await axios.get(audioUrl, { responseType: 'arraybuffer' });
          const audioBuffer = Buffer.from(audioRes.data);

          await sock.sendMessage(from, {
            audio: audioBuffer,
            mimetype: 'audio/mpeg',
            ptt: false,
          }, { quoted: msg });
        } catch (_) {
          // audio optional, skip silently
        }
      }

    } catch (err) {
      console.error('[tiktok]', err.message);
      await sock.sendMessage(from, {
        text: `◆ Error: ${err.message}`
      }, { quoted: msg });
    }
  }
};
