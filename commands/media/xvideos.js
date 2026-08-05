const config = require('../../config');
const {
  getInput,
  isHttpUrl,
  safeFileName,
  downloadVideoBuffer,
  fetchXvideos,
  searchXvideos,
} = require('./adultVideoHelpers');

module.exports = {
  name: 'xvideos',
  aliases: ['xvdl', 'xvid'],
  category: 'media',
  description: 'Download or search XVideos videos',
  usage: `${config.prefix || '.'}xvideos <URL or name>`,

  async execute(sock, msg, args, extra = {}) {
    const jid = msg.key.remoteJid;
    const input = getInput(msg, args);
    if (!input) {
      return sock.sendMessage(
        jid,
        { text: `Usage: ${extra.prefix || config.prefix || '.'}xvideos <URL or name>` },
        { quoted: msg },
      );
    }

    try {
      let videoUrl = input;
      let title;

      if (!isHttpUrl(input)) {
        const hit = await searchXvideos(input);
        if (!hit?.url) return sock.sendMessage(jid, { text: 'No XVideos result was found.' }, { quoted: msg });
        videoUrl = hit.url;
      }

      const result = await fetchXvideos(videoUrl);
      if (!result?.downloadUrl) {
        return sock.sendMessage(jid, { text: 'No downloadable XVideos video was found for that URL.' }, { quoted: msg });
      }
      title = result.title;

      const video = await downloadVideoBuffer(result.downloadUrl);
      await sock.sendMessage(
        jid,
        {
          video,
          caption: `${title || 'XVideos video'}\n${config.botName || 'JuneX-Ultra'}`,
          mimetype: 'video/mp4',
          fileName: safeFileName(title, 'xvideos'),
        },
        { quoted: msg },
      );
    } catch (error) {
      console.error('[XVIDEOS] Download error:', error);
      await sock.sendMessage(jid, { text: `Download failed: ${error.message || 'Unknown error'}` }, { quoted: msg });
    }
  },
};