const yts = require('yt-search');
const APIs = require('../../utils/api');

module.exports = {
  name: 'ytvideo',
  aliases: ['ytv', 'ytmp4', 'ytvid', 'video'],
  category: 'media',
  description: 'Download video from YouTube',
  usage: '.video <video name or URL>',

  async execute(sock, msg, args, extra) {
    try {
      const chatId = msg.key.remoteJid;
      const searchQuery = args.join(' ').trim();

      if (!searchQuery) {
        return await sock.sendMessage(chatId, {
          text: '🎬 Please provide a video name or YouTube URL.'
        }, { quoted: msg });
      }

      await sock.sendMessage(chatId, {
        react: { text: '🎬', key: msg.key }
      });

      const isUrl = searchQuery.startsWith('http://') || searchQuery.startsWith('https://');
      let videoUrl = searchQuery;
      let videoTitle = searchQuery;

      if (!isUrl) {
        const { videos } = await yts(searchQuery);
        if (!videos || videos.length === 0) {
          return await sock.sendMessage(chatId, {
            text: '❌ No videos found for that search.'
          }, { quoted: msg });
        }
        const found = videos[0];
        videoUrl = found.url;
        videoTitle = found.title;
      } else {
        try {
          const ytId = (videoUrl.match(/(?:youtu\.be\/|v=)([a-zA-Z0-9_-]{11})/) || [])[1];
          if (ytId) {
            const result = await yts({ videoId: ytId });
            if (result && result.title) videoTitle = result.title;
          }
        } catch (e) {}
      }

      // Validate YouTube URL
      const urls = videoUrl.match(/(?:https?:\/\/)?(?:youtu\.be\/|(?:www\.|m\.)?youtube\.com\/(?:watch\?v=|v\/|embed\/|shorts\/|playlist\?list=)?)([a-zA-Z0-9_-]{11})/gi);
      if (!urls) {
        return await sock.sendMessage(chatId, {
          text: '❌ This is not a valid YouTube link!'
        }, { quoted: msg });
      }

      // --- Download APIs ---
      const apiFns = [
        () => APIs.getEliteProTechVideoByUrl(videoUrl),
      ];

      let videoData = null;
      for (const fn of apiFns) {
        try {
          const result = await fn();
          if (result && result.download) {
            videoData = result;
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (!videoData || !videoData.download) {
        return await sock.sendMessage(chatId, {
          text: '❌ Failed to fetch video. Please try again later.'
        }, { quoted: msg });
      }

      const finalTitle = videoData.title || videoTitle;
      const safeTitle = finalTitle.replace(/[^\w\s\-()]/g, '').trim() || 'video';

      // --- Send video with title as caption ---
      await sock.sendMessage(chatId, {
        video: { url: videoData.download },
        mimetype: 'video/mp4',
        fileName: `${safeTitle}.mp4`,
        caption: finalTitle
      }, { quoted: msg });

    } catch (error) {
      console.error('[VIDEO] Command Error:', error?.message || error);
      await sock.sendMessage(msg.key.remoteJid, {
        text: '❌ Download failed: ' + (error?.message || 'Unknown error')
      }, { quoted: msg });
    }
  }
};
