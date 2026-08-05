const axios = require('axios');
const config = require('../../config');
const { downloadMedia } = require('./ephotoVideo');

function extractVideoUrl(html) {
  if (typeof html !== 'string') return null;
  const patterns = [
    /<video[^>]+src=["']([^"']+)["']/i,
    /<a[^>]+href=["']([^"']+\.(?:mp4|webm|mov)(?:\?[^"']*)?)["']/i,
    /<iframe[^>]+src=["']([^"']+)["']/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return match[1].startsWith('http') ? match[1] : `https://en.ephoto360.com${match[1]}`;
    }
  }
  return null;
}

async function generateTigerVideo(text) {
  const pageUrl = 'https://en.ephoto360.com/create-digital-tiger-logo-video-effect-723.html';
  try {
    const response = await axios.post(
      pageUrl,
      new URLSearchParams({ text, submit: 'Create' }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0',
          Referer: pageUrl,
        },
        timeout: 30000,
        maxRedirects: 5,
      },
    );
    const url = extractVideoUrl(response.data);
    if (url) return url;
  } catch (error) {
    console.error(`[TIGERVIDEO] Primary API failed: ${error.message}`);
  }

  const fallbacks = [
    `https://api.ephoto360.com/create-digital-tiger-logo-video-effect-723?text=${encodeURIComponent(text)}`,
    `https://ephoto-api.vercel.app/api/tiger-video?text=${encodeURIComponent(text)}`,
    `https://api.textpro.me/create-tiger-video?text=${encodeURIComponent(text)}`,
  ];
  for (const url of fallbacks) {
    try {
      const response = await axios.get(url, { timeout: 15000 });
      const result = response.data?.url || response.data?.result?.url || extractVideoUrl(response.data);
      if (result) return result;
    } catch {
      // Try the next provider.
    }
  }
  return null;
}

module.exports = {
  name: 'tigervideo',
  aliases: ['tigerlogo', 'tigertext', 'tigervid', 'tigeranimation'],
  category: 'aivideo',
  description: 'Create a digital tiger logo video with your text',
  usage: `${config.prefix || '.'}tigervideo <text>`,

  async execute(sock, msg, args, extra = {}) {
    const jid = msg.key.remoteJid;
    const prefix = extra.prefix || config.prefix || '.';
    await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } });

    try {
      const text = args.join(' ').trim();
      if (!text) {
        return sock.sendMessage(
          jid,
          {
            text: `🐯 Digital tiger logo video\n\nUsage: ${prefix}tigervideo <text>\nMaximum: 30 characters\nExamples:\n${prefix}tigervideo ${config.botName || 'JUNE-X'}\n${prefix}tigervideo TIGER KING`,
          },
          { quoted: msg },
        );
      }
      if (text.length > 30) {
        return sock.sendMessage(jid, { text: '❌ Text is too long! Please use maximum 30 characters.' }, { quoted: msg });
      }

      const videoUrl = await generateTigerVideo(text);
      if (!videoUrl) {
        return sock.sendMessage(jid, { text: `❌ Failed to generate tiger video for "${text}". Please try again later.` }, { quoted: msg });
      }

      const media = await downloadMedia(videoUrl);
      if (!media.isVideo) throw new Error('The tiger provider returned a non-video result');
      await sock.sendMessage(
        jid,
        {
          video: media.buffer,
          caption: `🐯 *DIGITAL TIGER VIDEO*\n📝 *Text:* ${text}`,
          mimetype: media.mimetype,
          gifPlayback: false,
        },
        { quoted: msg },
      );
      await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } });
    } catch (error) {
      console.error('[TIGERVIDEO] Error:', error);
      await sock.sendMessage(jid, { text: `❌ Error generating tiger video:\n${error.message}` }, { quoted: msg });
      await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } });
    }
  },
};