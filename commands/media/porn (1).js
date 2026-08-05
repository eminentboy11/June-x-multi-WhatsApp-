const config = require('../../config');
const {
  getInput,
  isHttpUrl,
  safeFileName,
  downloadVideoBuffer,
  fetchXvideos,
  fetchXhamster,
  searchXvideos,
} = require('./adultVideoHelpers');

function detectSite(url) {
  if (/xvideos\.com/i.test(url)) return 'xvideos';
  if (/xhamster\.(com|desi)/i.test(url)) return 'xhamster';
  return null;
}

module.exports = {
  name: 'porn',
  aliases: ['pornhub', 'porno', 'adultvid', '18plus'],
  category: 'media',
  description: 'Download adult videos by name or supported URL',
  usage: `${config.prefix || '.'}porn <name or URL>`,

  async execute(sock, msg, args, extra = {}) {
    const jid = msg.key.remoteJid;
    const input = getInput(msg, args);
    if (!input) {
      return sock.sendMessage(
        jid,
        { text: `Usage: ${extra.prefix || config.prefix || '.'}porn <name or URL>\nSupports XVideos and XHamster.` },
        { quoted: msg },
      );
    }

    try {
      let result;
      if (isHttpUrl(input)) {
        const site = detectSite(input);
        if (!site) {
          return sock.sendMessage(jid, { text: 'Unsupported URL. Use an XVideos or XHamster URL.' }, { quoted: msg });
        }
        result = site === 'xvideos'
          ? await fetchXvideos(input)
          : await fetchXhamster(input);
      } else {
        const hit = await searchXvideos(input);
        result = hit?.url ? await fetchXvideos(hit.url) : null;
      }

      if (!result?.downloadUrl) {
        return sock.sendMessage(jid, { text: 'No video was found. Try a different name or direct URL.' }, { quoted: msg });
      }

      const video = await downloadVideoBuffer(result.downloadUrl);
      const details = [result.title || 'Adult video', result.duration].filter(Boolean).join('\n');
      await sock.sendMessage(
        jid,
        {
          video,
          caption: `${details}\n${config.botName || 'JuneX-Ultra'}`,
          mimetype: 'video/mp4',
          fileName: safeFileName(result.title, 'adult-video'),
        },
        { quoted: msg },
      );
    } catch (error) {
      console.error('[PORN] Download error:', error);
      await sock.sendMessage(jid, { text: `Download failed: ${error.message || 'Unknown error'}` }, { quoted: msg });
    }
  },
};