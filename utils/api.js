/**
 * API Integration Utilities
 */

const axios = require('axios');

const api = axios.create({
  timeout: 30000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  }
});

const DOWNLOAD_HEADERS = {
  timeout: 60000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*'
  }
};

// ─── NVIDIA NIM (build.nvidia.com) config ───────────────────────
const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const NVIDIA_DEFAULT_MODEL = 'nvidia/nemotron-nano-12b-v2-vl';

function getNvidiaApiKey() {
  const key = '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';
  if (!key) {
    throw new Error(
      'NVIDIA_API_KEY is not set. Get a free key at https://build.nvidia.com and add it to your environment secrets.'
    );
  }
  return key;
}

async function callNvidia({ messages, model, maxTokens, temperature, timeoutMs }) {
  const { data } = await axios.post(
    NVIDIA_BASE_URL,
    {
      model: model || NVIDIA_DEFAULT_MODEL,
      messages,
      max_tokens: maxTokens ?? 2048,
      temperature: temperature ?? 0.7,
      top_p: 0.95,
      stream: false,
    },
    {
      headers: {
        Authorization: `Bearer ${getNvidiaApiKey()}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      timeout: timeoutMs ?? 90000,
    }
  );

  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty response from NVIDIA API');
  return typeof content === 'string'
    ? content
    : content.map(c => (typeof c === 'string' ? c : c.text || '')).join('');
}

const tryRequest = async (getter, attempts = 3) => {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await getter();
    } catch (err) {
      lastError = err;
      if (attempt < attempts) await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
  throw lastError;
};

const APIs = {

  // ─── AI & Tools ──────────────────────────────────────────────

  generateImage: async (prompt) => {
    try {
      const response = await api.get('https://api.siputzx.my.id/api/ai/stablediffusion', { params: { prompt } });
      return response.data;
    } catch {
      throw new Error('Failed to generate image');
    }
  },

  chatAI: async (text) => {
    try {
      const response = await api.get(`https://api.shizo.top/ai/gpt?apikey=shizo&query=${encodeURIComponent(text)}`);
      if (response.data?.msg) return { msg: response.data.msg };
      return response.data;
    } catch {
      throw new Error('Failed to get AI response');
    }
  },

  nvidiaChat: async (prompt, opts = {}) => {
    const { model, system, maxTokens, temperature, timeoutMs } = opts;
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: prompt });
    return callNvidia({ messages, model, maxTokens, temperature, timeoutMs });
  },

  nvidiaVision: async (prompt, image, opts = {}) => {
    const { model, maxTokens, temperature, timeoutMs } = opts;

    let imageUrl;
    if (Buffer.isBuffer(image)) {
      const b64 = image.toString('base64');
      imageUrl = `data:image/jpeg;base64,${b64}`;
    } else if (typeof image === 'string') {
      imageUrl = image;
    } else {
      throw new Error('nvidiaVision(): image must be a Buffer or URL string');
    }

    const messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt || 'Describe this image in detail.' },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      },
    ];

    return callNvidia({ messages, model, maxTokens, temperature, timeoutMs });
  },

  translate: async (text, to = 'en') => {
    try {
      const response = await api.get('https://api.siputzx.my.id/api/tools/translate', { params: { text, to } });
      const translated =
        response.data?.data?.translatedText ||
        response.data?.translatedText ||
        response.data?.result ||
        response.data?.translation;
      if (!translated) throw new Error('No translation returned');
      return { translation: translated };
    } catch {
      throw new Error('Translation failed');
    }
  },

  wikiSearch: async (query) => {
    try {
      const response = await api.get(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`);
      return response.data;
    } catch {
      throw new Error('Wikipedia search failed');
    }
  },

  shortenUrl: async (url) => {
    try {
      const response = await api.get('https://tinyurl.com/api-create.php', { params: { url } });
      return response.data;
    } catch {
      throw new Error('Failed to shorten URL');
    }
  },

  screenshotWebsite: async (url) => {
    try {
      const response = await axios.get(`https://eliteprotech-apis.zone.id/ssweb?url=${encodeURIComponent(url)}`, {
        timeout: 30000,
        responseType: 'arraybuffer',
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });
      if (response.headers['content-type']?.includes('image')) return Buffer.from(response.data);
      try {
        const data = JSON.parse(Buffer.from(response.data).toString());
        return data.url || data.data?.url || data.image;
      } catch {
        return Buffer.from(response.data);
      }
    } catch {
      throw new Error('Failed to take screenshot');
    }
  },

  textToSpeech: async (text) => {
    try {
      const response = await axios.get(`https://www.laurine.site/api/tts/tts-nova?text=${encodeURIComponent(text)}`, {
        timeout: 30000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });
      const d = response.data;
      if (!d) throw new Error('Empty response');
      if (typeof d === 'string' && d.startsWith('http')) return d;
      const src = d.data || d;
      if (src.URL) return src.URL;
      if (src.url) return src.url;
      if (src.MP3) return `https://ttsmp3.com/created_mp3_ai/${src.MP3}`;
      if (src.mp3) return `https://ttsmp3.com/created_mp3_ai/${src.mp3}`;
      throw new Error('Invalid API response structure');
    } catch (error) {
      throw new Error(`Failed to generate speech: ${error.message}`);
    }
  },

  // ─── Random Content ───────────────────────────────────────────

  getMeme: async () => {
    try {
      const response = await api.get('https://meme-api.com/gimme');
      return response.data;
    } catch {
      throw new Error('Failed to fetch meme');
    }
  },

  getQuote: async () => {
    try {
      const response = await api.get('https://zenquotes.io/api/random');
      const item = Array.isArray(response.data) ? response.data[0] : response.data;
      return { content: item.q, author: item.a };
    } catch {
      throw new Error('Failed to fetch quote');
    }
  },

  getJoke: async () => {
    try {
      const response = await api.get('https://official-joke-api.appspot.com/random_joke');
      return response.data;
    } catch {
      throw new Error('Failed to fetch joke');
    }
  },

  getWeather: async (city) => {
    try {
      const response = await api.get('https://api.siputzx.my.id/api/tools/weather', { params: { city } });
      return response.data;
    } catch {
      throw new Error('Failed to fetch weather');
    }
  },

  // ─── YouTube Audio Download ───────────────────────────────────

  getIzumiDownloadByUrl: async (youtubeUrl) => {
    const res = await tryRequest(() =>
      axios.get(`https://apiskeith2-production-3020.up.railway.app/download/audio?url=${encodeURIComponent(youtubeUrl)}`, DOWNLOAD_HEADERS)
    );
    if (res?.data?.status && res?.data?.result) {
      return {
        download: res.data.result,
        thumbnail: res.data.result.thumbnail
      };
    }
    throw new Error('no download URL returned');
  },

  getIzumiDownloadByQuery: async (query) => {
    const res = await tryRequest(() =>
      axios.get(`https://yt-dl.officialhectormanuel.workers.dev/?url=${encodeURIComponent(query)}`, DOWNLOAD_HEADERS)
    );
    if (res?.data?.audio) {
      return {
        download: res.data.audio,
        title: res.data.title,
        thumbnail: res.data.thumbnail
      };
    }
    throw new Error('Izumi query: no download URL returned');
  },

  getEliteProTechDownloadByUrl: async (youtubeUrl) => {
    const res = await tryRequest(() =>
      axios.get(`https://yt-dl.officialhectormanuel.workers.dev/?url=${encodeURIComponent(youtubeUrl)}`, DOWNLOAD_HEADERS)
    );
    if (res?.data?.audio) {
      return {
        download: res.data.audio,
        title: res.data.title
      };
    }
    throw new Error('casper audio: no download URL returned');
  },

  // ─── YouTube Video Download ───────────────────────────────────

  getEliteProTechVideoByUrl: async (youtubeUrl) => {
    const res = await tryRequest(() =>
      axios.get(`https://apissupreme.vercel.app/media/ytmp4?apikey=supreme&url=${encodeURIComponent(youtubeUrl)}&format=mp4`, DOWNLOAD_HEADERS)
    );
    if (res?.data?.status && res?.data?.downloadUrl) {
      return {
        download: res.data.downloadUrl,
        title: res.data.title
      };
    }
    throw new Error('video: no download URL returned');
  },

  // ─── Social Media Download ────────────────────────────────────

  igDownload: async (url) => {
    try {
      const response = await api.get('https://api.siputzx.my.id/api/d/igdl', { params: { url } });
      return response.data;
    } catch {
      throw new Error('Failed to download Instagram content');
    }
  },

  getTikTokDownload: async (url) => {
    try {
      const response = await axios.get(`https://api.siputzx.my.id/api/d/tiktok?url=${encodeURIComponent(url)}`, {
        timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });
      if (response.data?.status && response.data?.data) {
        const d = response.data.data;
        const videoUrl =
          d.urls?.[0] ||
          d.video_url ||
          d.url ||
          d.download_url ||
          null;
        const title = d.metadata?.title || 'TikTok Video';
        return { videoUrl, title };
      }
      throw new Error('Invalid API response');
    } catch {
      throw new Error('TikTok download failed');
    }
  },

  // ─── Stalker Profiles ──────────────────────────────────────────
  stalkGitHub: async (username) => {
    const res = await api.get('https://apis.xwolf.space/api/stalk/github', { params: { username }, timeout: 20000 });
    const raw = res.data;
    const d = raw?.result || raw?.data || raw;
    if (!d || (!d.login && !d.username)) throw new Error('User not found on GitHub');
    return raw;
  },

  stalkInstagram: async (username) => {
    const res = await api.get(globalThis._apiOverrides?.['igstalk'] || 'https://api.giftedtech.co.ke/api/stalk/igstalk', {
      params: { apikey: 'gifted', username }, timeout: 20000
    });
    if (!res.data?.success || !res.data?.result) throw new Error('User not found');
    return res.data.result;
  },

  stalkIp: async (address) => {
    const res = await api.get(globalThis._apiOverrides?.['ipstalk'] || 'https://api.giftedtech.co.ke/api/stalk/ipstalk', {
      params: { apikey: 'gifted', address }, timeout: 20000
    });
    if (!res.data?.success || !res.data?.result) throw new Error('Could not retrieve IP information');
    return res.data.result;
  },

  stalkNpm: async (packagename) => {
    const res = await api.get(globalThis._apiOverrides?.['npmstalk'] || 'https://api.giftedtech.co.ke/api/stalk/npmstalk', {
      params: { apikey: 'gifted', packagename }, timeout: 25000
    });
    if (!res.data?.success || !res.data?.result) throw new Error('Package not found on NPM');
    return res.data.result;
  },

  stalkTikTok: async (username) => {
    try {
      const res = await api.get('https://apis.xwolf.space/api/stalk/tiktok', { params: { username }, timeout: 15000 });
      const d = res.data;
      if (d?.success && d?.username) {
        return {
          name: d.nickname || d.username, username: d.username, bio: d.bio || 'N/A',
          avatar: d.avatar || null, followers: d.followers ?? 0, following: d.following ?? 0,
          likes: d.likes ?? 0, videos: d.videos ?? null, verified: d.verified ?? false,
          private: d.privateAccount ?? false, profileUrl: d.profileUrl || null, source: 'xwolf'
        };
      }
    } catch {}
    const res = await api.get('https://api.giftedtech.co.ke/api/stalk/tiktokstalk', {
      params: { apikey: 'gifted', username }, timeout: 20000
    });
    if (!res.data?.success || !res.data?.result) throw new Error('User not found');
    const d = res.data.result;
    return {
      name: d.name || d.username, username: d.username || username, bio: d.bio || 'N/A',
      avatar: d.avatar || null, followers: d.followers ?? 0, following: d.following ?? 0,
      likes: d.likes ?? 0, videos: null, verified: d.verified ?? false,
      private: d.private ?? false, profileUrl: d.website?.link || null, source: 'gifted'
    };
  },

  stalkTwitter: async (username) => {
    const res = await api.get(globalThis._apiOverrides?.['twitterstalk'] || 'https://api.giftedtech.co.ke/api/stalk/twitterstalk', {
      params: { apikey: 'gifted', username }, timeout: 25000
    });
    if (!res.data?.success || !res.data?.result) throw new Error('User not found or Twitter API unavailable');
    return res.data.result;
  },

  stalkWachannel: async (url) => {
    const res = await api.get('https://api.giftedtech.co.ke/api/stalk/wachannel', {
      params: { apikey: 'gifted', url }, timeout: 20000
    });
    if (!res.data?.success || !res.data?.result) throw new Error('Channel not found or invalid URL');
    return res.data.result;
  },

};

APIs.NVIDIA_DEFAULT_MODEL = NVIDIA_DEFAULT_MODEL;
APIs.NVIDIA_BASE_URL = NVIDIA_BASE_URL;

module.exports = APIs;
