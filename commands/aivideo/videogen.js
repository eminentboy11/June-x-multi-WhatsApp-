const axios = require('axios');
const config = require('../../config');

function getVideoFile(video) {
  return video?.video_files
    ?.filter((file) => file?.link)
    ?.sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.link;
}

module.exports = {
  name: 'videogen',
  // `video` is already used by an existing June-X command; keep that trigger intact.
  aliases: ['vgen'],
  category: 'aivideo',
  description: 'Fetch a short video from a keyword',
  usage: `${config.prefix || '.'}videogen <keyword>`,

  async execute(sock, msg, args, extra = {}) {
    const jid = msg.key.remoteJid;
    const prefix = extra.prefix || config.prefix || '.';
    const query = args.join(' ').trim();
    await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } });

    if (!query) {
      return sock.sendMessage(
        jid,
        {
          text: `🎬 Video generator\n\nUsage: ${prefix}videogen <keyword>\nExample: ${prefix}videogen wolf anime`,
        },
        { quoted: msg },
      );
    }

    const apiKey = process.env.PEXELS_API_KEY?.trim();
    if (!apiKey) {
      return sock.sendMessage(
        jid,
        { text: '❌ Video search is not configured. Add `PEXELS_API_KEY` to the June-X environment before using this command.' },
        { quoted: msg },
      );
    }

    try {
      const response = await axios.get('https://api.pexels.com/videos/search', {
        params: { query, per_page: 3 },
        headers: { Authorization: apiKey },
        timeout: 30000,
      });
      const videos = response.data?.videos || [];
      if (!videos.length) {
        return sock.sendMessage(jid, { text: `❌ No videos found for "${query}".` }, { quoted: msg });
      }

      const videoUrl = getVideoFile(videos[Math.floor(Math.random() * videos.length)]);
      if (!videoUrl) throw new Error('The video service returned no playable file');

      await sock.sendMessage(
        jid,
        {
          video: { url: videoUrl },
          caption: `🎬 Video result for: "${query}"\n${config.botName || 'JuneX-Ultra'} Video`,
        },
        { quoted: msg },
      );
    } catch (error) {
      console.error('[VIDEOGEN] Error:', error);
      await sock.sendMessage(jid, { text: `⚠️ Failed to fetch video: ${error.message}` }, { quoted: msg });
    }
  },
};