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
      axios.get(`https://yt-dl.officialhectormanuel.workers.dev/?url=${encodeURIComponent(youtubeUrl)}`, DOWNLOAD_HEADERS)
    );
    if (res?.data?.audio) {
      return {
        download: res.data.audio,
        title: res.data.title,
        thumbnail: res.data.thumbnail
      };
    }
    throw new Error(' no download URL returned');
  },

  getIzumiDownloadByQuery: async (query) => {
    const res = await tryRequest(() =>
      axios.get(`https://mcow.giftedtechnexus.workers.dev/api/yta?url=${encodeURIComponent(query)}`, DOWNLOAD_HEADERS)
    );
    if (res?.data?.result?.download_url) {
      return {
        download: res.data.result.download_url,
        title: res.data.result.title,
        thumbnail: res.data.result.thumbnail
      };
    }
    throw new Error('Izumi query: no download URL returned');
  },

  getEliteProTechDownloadByUrl: async (youtubeUrl) => {
    const res = await tryRequest(() =>
      axios.get(`https://mcow.giftedtechnexus.workers.dev/api/yta?url=${encodeURIComponent(youtubeUrl)}&format=mp3`, DOWNLOAD_HEADERS)
    );
    if (res?.data?.success && res?.data?.result?.download_url) {
      return {
        download: res.data.result.download_url,
        title: res.data.result.title
      };
    }
    throw new Error('EliteProTech audio: no download URL returned');
  },

  // ─── YouTube Video Download ───────────────────────────────────

  getEliteProTechVideoByUrl: async (youtubeUrl) => {
    const res = await tryRequest(() =>
      axios.get(`https://iamtkm.vercel.app/downloaders/ytmp4?apikey=tkm&url=${encodeURIComponent(youtubeUrl)}&format=mp4`, DOWNLOAD_HEADERS)
    );
    if (res?.data?.status && res?.data?.data?.url) {
      return {
        download: res.data.data.url,
        title: res.data.data.title
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
  }

};

module.exports = APIs;
