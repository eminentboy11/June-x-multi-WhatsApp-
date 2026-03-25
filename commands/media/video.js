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
      const text = args.join(' ');
      const chatId = msg.key.remoteJid;
      const searchQuery = text.trim();

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
      let videoThumbnail = '';
      let duration = '';
      let views = '';
      let author = '';

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
        videoThumbnail = found.thumbnail || '';
        duration = found.timestamp || '';
        views = found.views ? found.views.toLocaleString() : '';
        author = found.author?.name || '';
      } else {
        try {
          const ytId = (videoUrl.match(/(?:youtu\.be\/|v=)([a-zA-Z0-9_-]{11})/) || [])[1];
          if (ytId) {
            const result = await yts({ videoId: ytId });
            if (result && result.title) {
              videoTitle = result.title;
              videoThumbnail = result.thumbnail || '';
              duration = result.timestamp || '';
              views = result.views ? result.views.toLocaleString() : '';
              author = result.author?.name || '';
            }
          }
        } catch (e) {}
      }

      const urls = videoUrl.match(/(?:https?:\/\/)?(?:youtu\.be\/|(?:www\.|m\.)?youtube\.com\/(?:watch\?v=|v\/|embed\/|shorts\/|playlist\?list=)?)([a-zA-Z0-9_-]{11})/gi);
      if (!urls) {
        return await sock.sendMessage(chatId, {
          text: '❌ This is not a valid YouTube link!'
        }, { quoted: msg });
      }

      let info = `🎬 *${videoTitle}*`;
      if (author) info += `\n👤 *Channel:* ${author}`;
      if (duration) info += `\n⏱ *Duration:* ${duration}`;
      if (views) info += `\n👁 *Views:* ${views}`;
      info += `\n\n_Downloading..._`;

      const ytId = (videoUrl.match(/(?:youtu\.be\/|v=)([a-zA-Z0-9_-]{11})/) || [])[1];
      const thumb = videoThumbnail || (ytId ? `https://i.ytimg.com/vi/${ytId}/sddefault.jpg` : null);

      if (thumb) {
        try {
          await sock.sendMessage(chatId, {
            image: { url: thumb },
            caption: info
          }, { quoted: msg });
        } catch (e) {
          await sock.sendMessage(chatId, { text: info }, { quoted: msg });
        }
      } else {
        await sock.sendMessage(chatId, { text: info }, { quoted: msg });
      }

      const apiFns = [
        () => APIs.getApisKeithVideoByUrl(videoUrl),
        () => APIs.getEliteProTechVideoByUrl(videoUrl),
        () => APIs.getYupraVideoByUrl(videoUrl),
        () => APIs.getOkatsuVideoByUrl(videoUrl),
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

      const safeTitle = videoTitle.replace(/[^\w\s\-()]/g, '').trim() || 'video';

      await sock.sendMessage(chatId, {
        video: { url: videoData.download },
        mimetype: 'video/mp4',
        fileName: `${safeTitle}.mp4`,
        caption: `🎬 *${videoTitle}*${author ? `\n👤 ${author}` : ''}${duration ? `\n⏱ ${duration}` : ''}\n\n> *_Downloaded by ${config.botName}_*`
      }, { quoted: msg });

    } catch (error) {
      console.error('[VIDEO] Command Error:', error?.message || error);
      await sock.sendMessage(msg.key.remoteJid, {
        text: '❌ Download failed: ' + (error?.message || 'Unknown error')
      }, { quoted: msg });
    }
  }
};
