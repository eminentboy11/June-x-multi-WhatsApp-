const { applyFont } = require('../utils/fontConverter');
const axios = require('axios');

// ── DuckDuckGo Image Search (free, no API key) ───────────────
async function ddgImageSearch(query, count = 10) {
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Referer: 'https://duckduckgo.com/',
  };

  // Step 1: Get the VQD token required by DDG
  const initRes = await axios.get('https://duckduckgo.com/', {
    params: { q: query, iax: 'images', ia: 'images' },
    headers,
    timeout: 15000,
  });

  const vqdMatch = initRes.data.match(/vqd=["']?([^"'&\s]+)/);
  if (!vqdMatch) throw new Error('Could not fetch VQD token from DuckDuckGo');
  const vqd = vqdMatch[1];

  // Step 2: Hit the image results endpoint
  const imgRes = await axios.get('https://duckduckgo.com/i.js', {
    params: {
      q: query,
      vqd,
      f: ',,,,,',
      p: 1,
      v7exp: 'a',
    },
    headers,
    timeout: 15000,
  });

  const results = imgRes.data?.results || [];
  if (!results.length) throw new Error('No images found for that query');

  // Return up to `count` image URLs (full-size)
  return results.slice(0, count).map((r) => r.image);
}

// ── Download image buffer from URL ──────────────────────────
async function downloadImage(url) {
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 20000,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });
  return Buffer.from(res.data);
}

module.exports = [
  {
    name: 'image',
    aliases: ['img-search', 'photo', 'pic', 'search-img'],
    category: 'general',
    description: 'Search and fetch an image from the web using DuckDuckGo',
    usage: '.image <query> [--num 1-10]',

    async execute(sock, msg, args, extra) {
      const jid = msg.key.remoteJid;

      // ── Helpers ────────────────────────────────────────────
      const react = (emoji) =>
        sock.sendMessage(jid, { react: { text: emoji, key: msg.key } });

      const reply = (text) =>
        sock.sendMessage(
          jid,
          { text: applyFont(text) },
          { quoted: msg }
        );

      // ── Parse args ─────────────────────────────────────────
      // Support: .image lion --num 3
      let rawArgs = [...args];
      let sendCount = 1;

      const numIndex = rawArgs.indexOf('--num');
      if (numIndex !== -1 && rawArgs[numIndex + 1]) {
        const parsed = parseInt(rawArgs[numIndex + 1], 10);
        if (!isNaN(parsed) && parsed >= 1 && parsed <= 5) sendCount = parsed;
        rawArgs.splice(numIndex, 2); // remove --num flag from query
      }

      const query = rawArgs.join(' ').trim();

      if (!query) {
        return reply(
          `┏━━『 🖼️ IMAGE SEARCH 』━━\n` +
          `┃\n` +
          `┃  ➥ Usage   ➜ .image <query>\n` +
          `┃  ➥ Multi   ➜ .image <query> --num 3\n` +
          `┃  ➥ Example ➜ .image Nairobi city\n` +
          `┃  ➥ Max     ➜ 5 images at once\n` +
          `┃\n` +
          `┗━━━━━━━━━━━━━━━━━━━━━━━`
        );
      }

      await react('🔍');
      await reply(
        `┏━━『 🖼️ IMAGE SEARCH 』━━\n` +
        `┃  ➥ Query  ➜ ${query}\n` +
        `┃  ➥ Count  ➜ Fetching ${sendCount} image${sendCount > 1 ? 's' : ''}...\n` +
        `┗━━━━━━━━━━━━━━━━━━━━━━━`
      );

      try {
        // ── Search ────────────────────────────────────────────
        const imageUrls = await ddgImageSearch(query, sendCount * 3); // fetch extras as fallback
        if (!imageUrls.length) throw new Error('No results returned');

        let sent = 0;
        let tried = 0;

        // Try URLs until we've sent enough or exhausted the list
        while (sent < sendCount && tried < imageUrls.length) {
          const url = imageUrls[tried++];
          try {
            const buffer = await downloadImage(url);

            // Basic JPEG/PNG/WebP check
            const magic = buffer.slice(0, 4).toString('hex');
            const isImage =
              magic.startsWith('ffd8') ||   // JPEG
              magic.startsWith('89504e47') || // PNG
              magic.startsWith('52494646');  // WebP

            if (!isImage) continue; // skip non-image responses

            await sock.sendMessage(
              jid,
              {
                image: buffer,
                caption: applyFont(
                  sent === 0
                    ? `┏━━『 🖼️ IMAGE SEARCH 』━━\n` +
                      `┃  ➥ Query   ➜ ${query}\n` +
                      `┃  ➥ Result  ➜ ${sent + 1} of ${sendCount}\n` +
                      `┃  ➥ Source  ➜ DuckDuckGo Images\n` +
                      `┗━━━━━━━━━━━━━━━━━━━━━━━`
                    : `┃  ➥ Result  ➜ ${sent + 1} of ${sendCount}`
                ),
              },
              { quoted: msg }
            );

            sent++;
          } catch {
            // This URL failed — silently try the next one
          }
        }

        if (sent === 0) throw new Error('All image URLs failed to download');

        await react('✅');
      } catch (err) {
        console.error('[image] Error:', err.message);
        await react('❌');
        await reply(
          `┏━━『 🖼️ IMAGE SEARCH 』━━\n` +
          `┃\n` +
          `┃  ➥ Status  ➜ Failed\n` +
          `┃  ➥ Reason  ➜ ${err.message || 'Unknown error'}\n` +
          `┃  ➥ Tip     ➜ Try different keywords\n` +
          `┃\n` +
          `┗━━━━━━━━━━━━━━━━━━━━━━━`
        );
      }
    },
  },
];
