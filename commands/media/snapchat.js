const axios = require('axios');
const config = require('../../config');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';

function isValidSnapchatUrl(url) {
  return /^https?:\/\/(?:www\.)?snapchat\.com\/spotlight\/[a-zA-Z0-9_-]+/i.test(url);
}

async function getDownloadUrl(url) {
  const services = [
    async () => {
      const response = await axios.get('https://api.tiklydown.eu.org/api/download', { params: { url }, timeout: 15000 });
      return response.data?.videoUrl;
    },
    async () => {
      const response = await axios.post('https://ssstik.io/api', { url }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000,
      });
      return response.data?.downloadUrl;
    },
    async () => {
      const response = await axios.get('https://savetik.co/api/ajaxSearch', {
        params: { text: url, lang: 'en' },
        timeout: 15000,
      });
      return response.data?.links?.[0]?.a;
    },
    async () => {
      const response = await axios.get('https://www.tikwm.com/api/', {
        params: { url, hd: 1 },
        timeout: 15000,
      });
      return response.data?.data?.play;
    },
    async () => {
      const response = await axios.get('https://api16-normal-c-useast1a.tiktokv.com/aweme/v1/feed/', {
        params: { aweme_id: url.split('/').pop().split('?')[0] },
        headers: { 'User-Agent': 'TikTok 26.2.0 rv:262018 (iPhone; iOS 14.4.2; en_US) Cronet' },
        timeout: 15000,
      });
      return response.data?.aweme_list?.[0]?.video?.play_addr?.url_list?.[0];
    },
    async () => {
      const response = await axios.post('https://musicallydown.com/download', `video_url=${encodeURIComponent(url)}`, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT,
        },
        timeout: 15000,
      });
      const match = String(response.data).match(/href=["']([^"']+\.mp4[^"']*)["']/i);
      return match?.[1] ? new URL(match[1], 'https://musicallydown.com').href : null;
    },
  ];

  for (const service of services) {
    try {
      const downloadUrl = await service();
      if (downloadUrl) return downloadUrl;
    } catch {
      // Try the next provider.
    }
  }
  return null;
}

async function downloadVideo(url) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 60000,
    maxRedirects: 5,
    maxContentLength: 48 * 1024 * 1024,
    maxBodyLength: 48 * 1024 * 1024,
    headers: { 'User-Agent': USER_AGENT, Accept: 'video/mp4,video/*;q=0.9,*/*;q=0.8' },
  });
  const buffer = Buffer.from(response.data);
  if (buffer.length < 5000) throw new Error('Received invalid or empty video data');
  return buffer;
}

module.exports = {
  name: 'snapchat',
  // `sc` belongs to June-X's existing SoundCloud command and is intentionally preserved.
  aliases: ['snap'],
  category: 'media',
  description: 'Download Snapchat Spotlight videos',
  usage: `${config.prefix || '.'}snapchat <Spotlight URL>`,

  async execute(sock, msg, args, extra = {}) {
    const jid = msg.key.remoteJid;
    const prefix = extra.prefix || config.prefix || '.';
    const url = args[0]?.trim();

    if (!url) {
      return sock.sendMessage(jid, { text: `Usage: ${prefix}snapchat <Snapchat Spotlight URL>` }, { quoted: msg });
    }
    if (!isValidSnapchatUrl(url)) {
      return sock.sendMessage(jid, { text: 'Please provide a valid Snapchat Spotlight URL.' }, { quoted: msg });
    }

    try {
      const downloadUrl = await getDownloadUrl(url);
      if (!downloadUrl) {
        return sock.sendMessage(jid, { text: 'No Snapchat download service returned a video.' }, { quoted: msg });
      }
      const video = await downloadVideo(downloadUrl);
      await sock.sendMessage(
        jid,
        {
          video,
          caption: `Snapchat Spotlight\n${config.botName || 'JuneX-Ultra'}`,
          mimetype: 'video/mp4',
        },
        { quoted: msg },
      );
    } catch (error) {
      console.error('[SNAPCHAT] Download error:', error);
      await sock.sendMessage(jid, { text: `Download failed: ${error.message || 'Unknown error'}` }, { quoted: msg });
    }
  },
};