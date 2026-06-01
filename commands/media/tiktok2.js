// commands/tt2.js
const axios = require('axios');

module.exports = {
  name: 'tt2',
  aliases: ['tiktok2'],
  category: 'downloader',
  description: 'Download TikTok video (no watermark)',

  async execute(sock, msg, args, extra) {
    const { from } = extra;
    const url = args[0];

    if (!url || !url.includes('tiktok.com')) {
      return sock.sendMessage(from, {
        text: `◆ *TikTok Downloader* ◆\n\n◇ Usage: .tt2 <tiktok_url>\n◇ Example: .tt2 https://vm.tiktok.com/xxxxx`
      }, { quoted: msg });
    }

    try {
      let videoUrl = null;
      let audioUrl = null;

      try {
        const { data } = await axios.post(
          'https://www.tikwm.com/api/',
          new URLSearchParams({ url, hd: '1' }),
          { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        if (data?.code === 0 && data?.data?.play) {
          videoUrl = data.data.hdplay || data.data.play;
          audioUrl = data.data.music;
        }
      } catch (_) {}

      if (!videoUrl) {
        const { data } = await axios.get(
          `https://api.tiklydown.eu.org/api/download?url=${encodeURIComponent(url)}`
        );

        if (data?.video?.noWatermark) {
          videoUrl = data.video.noWatermark;
          audioUrl = data.music?.play_url || null;
        }
      }

      if (!videoUrl) {
        return sock.sendMessage(from, {
          text: `◆ Failed to fetch video.\n◇ The link may be private or unsupported.`
        }, { quoted: msg });
      }

      const videoRes = await axios.get(videoUrl, { responseType: 'arraybuffer' });
      const videoBuffer = Buffer.from(videoRes.data);

      await sock.sendMessage(from, {
        video: videoBuffer,
        mimetype: 'video/mp4',
      }, { quoted: msg });

      if (audioUrl) {
        try {
          const audioRes = await axios.get(audioUrl, { responseType: 'arraybuffer' });
          const audioBuffer = Buffer.from(audioRes.data);

          await sock.sendMessage(from, {
            audio: audioBuffer,
            mimetype: 'audio/mpeg',
            ptt: false,
          }, { quoted: msg });
        } catch (_) {}
      }

    } catch (err) {
      console.error('[tt2]', err.message);
      await sock.sendMessage(from, {
        text: `◆ Error: ${err.message}`
      }, { quoted: msg });
    }
  }
};
