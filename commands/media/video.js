const yts = require('yt-search');
const APIs = require('../../utils/api');
const config = require('../../config');

module.exports = {
  name: 'ytvideo',
  aliases: ['ytv', 'ytmp4', 'ytvid', 'video'],
  category: 'media',
  description: 'Download video from YouTube',
  usage: '.video <video name or URL>',

  async execute(sock, msg, args, extra) {
    try {
      const instanceConfig = config;

      const text = args.join(' ');
      const chatId = msg.key.remoteJid;
      const searchQuery = text.trim();

      if (!searchQuery) {
        return await sock.sendMessage(chatId, {
          text: 'What video do you want to download?'
        }, { quoted: msg });
      }

      await sock.sendMessage(chatId, {
        react: { text: '🎬', key: msg.key }
      });

      let videoUrl = '';
      let videoTitle = '';
      let videoThumbnail = '';

      const isUrl = searchQuery.startsWith('http://') || searchQuery.startsWith('https://');

      if (isUrl) {
        videoUrl = searchQuery;
      } else {
        const { videos } = await yts(searchQuery);
        if (!videos || videos.length === 0) {
          return await sock.sendMessage(chatId, {
            text: 'No videos found!'
          }, { quoted: msg });
        }
        videoUrl = videos[0].url;
        videoTitle = videos[0].title;
        videoThumbnail = videos[0].thumbnail;
      }

      try {
        const ytId = (videoUrl.match(/(?:youtu\.be\/|v=)([a-zA-Z0-9_-]{11})/) || [])[1];
        const thumb = videoThumbnail || (ytId ? `https://i.ytimg.com/vi/${ytId}/sddefault.jpg` : undefined);
        const captionTitle = videoTitle || searchQuery;
        if (thumb) {
          await sock.sendMessage(chatId, {
            image: { url: thumb },
            caption: `*${captionTitle}*\nDownloading...`
          }, { quoted: msg });
        }
      } catch (e) {
        console.error('[VIDEO] thumb error:', e?.message || e);
      }

      const urls = videoUrl.match(/(?:https?:\/\/)?(?:youtu\.be\/|(?:www\.|m\.)?youtube\.com\/(?:watch\?v=|v\/|embed\/|shorts\/|playlist\?list=)?)([a-zA-Z0-9_-]{11})/gi);
      if (!urls) {
        return await sock.sendMessage(chatId, {
          text: 'This is not a valid YouTube link!'
        }, { quoted: msg });
      }

      let videoData = null;

      const apiFns = [
        () => APIs.getApisKeithVideoByUrl(videoUrl),
        () => APIs.getEliteProTechVideoByUrl(videoUrl),
        () => APIs.getYupraVideoByUrl(videoUrl),
        () => APIs.getOkatsuVideoByUrl(videoUrl),
      ];

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
          text: 'Failed to fetch video. Please try again later.'
        }, { quoted: msg });
      }

      await sock.sendMessage(chatId, {
        video: { url: videoData.download },
        mimetype: 'video/mp4',
        fileName: `${(videoData.title || videoTitle || 'video').replace(/[^\w\s-]/g, '')}.mp4`,
        caption: `*${videoData.title || videoTitle || 'Video'}*\n\n> *_Downloaded by ${instanceConfig.botName}_*`
      }, { quoted: msg });

    } catch (error) {
      console.error('[VIDEO] Command Error:', error?.message || error);
      await sock.sendMessage(msg.key.remoteJid, {
        text: 'Download failed: ' + (error?.message || 'Unknown error')
      }, { quoted: msg });
    }
  }
};
