const axios = require('axios');
const mumaker = require('mumaker');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';

function resultUrlFrom(data) {
  return data?.url || data?.image || data?.img || data?.result?.url || data?.result?.image || null;
}

async function generateEphoto(effectUrl, text) {
  const encodedText = encodeURIComponent(text);
  const fallbackEndpoints = [
    `https://api-photooxy.vercel.app/api/ephoto360?url=${encodeURIComponent(effectUrl)}&text=${encodedText}`,
    `https://widipe.com/ephoto360?url=${encodeURIComponent(effectUrl)}&text=${encodedText}`,
  ];

  for (const endpoint of fallbackEndpoints) {
    try {
      const response = await axios.get(endpoint, {
        timeout: 15000,
        headers: { 'User-Agent': USER_AGENT },
      });
      const url = resultUrlFrom(response.data);
      if (url) return url;
    } catch {
      // Try the next provider.
    }
  }

  try {
    const result = await mumaker.ephoto(effectUrl, text);
    const url = resultUrlFrom(result);
    if (url) return url;
  } catch (error) {
    console.error(`[AIVIDEO] Ephoto fallback failed: ${error.message}`);
  }

  return null;
}

async function downloadMedia(url, timeout = 45000) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout,
    maxContentLength: 60 * 1024 * 1024,
    maxBodyLength: 60 * 1024 * 1024,
    headers: {
      'User-Agent': USER_AGENT,
      Accept: '*/*',
      Referer: 'https://en.ephoto360.com/',
    },
  });

  const buffer = Buffer.from(response.data);
  if (!buffer.length) throw new Error('Generated media is empty');
  if (buffer.length > 50 * 1024 * 1024) {
    throw new Error(`Generated media is too large (${(buffer.length / 1024 / 1024).toFixed(2)}MB)`);
  }

  const contentType = String(response.headers['content-type'] || '').toLowerCase();
  const isVideo =
    contentType.startsWith('video/') ||
    /\.(mp4|webm|mov)(?:[?#]|$)/i.test(url);

  return {
    buffer,
    isVideo,
    mimetype: isVideo ? (contentType.startsWith('video/') ? contentType : 'video/mp4') : 'image/jpeg',
    sizeMB: (buffer.length / 1024 / 1024).toFixed(2),
  };
}

async function sendGeneratedMedia(sock, msg, media, { videoCaption, imageCaption }) {
  const content = media.isVideo
    ? {
        video: media.buffer,
        caption: videoCaption,
        mimetype: media.mimetype,
        gifPlayback: false,
      }
    : {
        image: media.buffer,
        caption: imageCaption,
      };

  return sock.sendMessage(msg.key.remoteJid, content, { quoted: msg });
}

module.exports = {
  generateEphoto,
  downloadMedia,
  sendGeneratedMedia,
};