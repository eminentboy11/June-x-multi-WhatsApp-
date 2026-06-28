const axios = require('axios');

const react = async (sock, msg, emoji) => {
  try {
    await sock.sendMessage(msg.key.remoteJid, {
      react: { text: emoji, key: msg.key }
    });
  } catch (_) {}
};

const fetchAndSend = async (sock, msg, apiUrl, label, emoji) => {
  const jid = msg.key.remoteJid;

  await react(sock, msg, emoji);

  let imageUrl = null;

  try {
    const res = await axios.get(apiUrl, { timeout: 10000 });
    const data = res.data;
    imageUrl =
      data?.url ||
      data?.image ||
      data?.image_url ||
      (data?.data && (data.data.url || data.data.image)) ||
      null;
  } catch (err) {
    console.error(`[${label}] fetch error:`, err.message);
    await react(sock, msg, '❌');
    await sock.sendMessage(jid, {
      text: `❌ Failed to fetch ${label} image. Please try again later.`
    }, { quoted: msg });
    return;
  }

  if (!imageUrl) {
    await react(sock, msg, '❌');
    await sock.sendMessage(jid, {
      text: `❌ Could not fetch ${label} image. Try again!`
    }, { quoted: msg });
    return;
  }

  await sock.sendMessage(jid, {
    image: { url: imageUrl },
    caption: `${emoji} ${label}\n━━━━━━━━━━━━━━━`
  }, { quoted: msg });

  await react(sock, msg, '✅');
};

module.exports = [
  {
    name: 'neko',
    aliases: ['catgirl', 'nekogirl'],
    category: 'Fun',
    description: 'Get a random SFW neko image',
    usage: '.neko',
    async handler(sock, msg) {
      await fetchAndSend(sock, msg, 'https://api.shizo.top/sfw/neko?apikey=shizo', 'Random Neko', '🐱');
    }
  },
  {
    name: 'waifu',
    aliases: ['randomwaifu', 'anime'],
    category: 'Fun',
    description: 'Get a random SFW waifu image',
    usage: '.waifu',
    async handler(sock, msg) {
      await fetchAndSend(sock, msg, 'https://api.shizo.top/sfw/waifu?apikey=shizo', 'Random Waifu', '✨');
    }
  },
  {
    name: 'happy',
    aliases: ['animehappy'],
    category: 'Fun',
    description: 'Get a random SFW happy anime image',
    usage: '.happy',
    async handler(sock, msg) {
      await fetchAndSend(sock, msg, 'https://api.shizo.top/sfw/happy?apikey=shizo', 'Happy Anime', '😊');
    }
  },
  {
    name: 'sad',
    aliases: ['animesad'],
    category: 'Fun',
    description: 'Get a random SFW sad anime image',
    usage: '.sad',
    async handler(sock, msg) {
      await fetchAndSend(sock, msg, 'https://api.shizo.top/sfw/sad?apikey=shizo', 'Sad Anime', '😢');
    }
  },
  {
    name: 'husby',
    aliases: ['husband', 'animehusband', 'husbando'],
    category: 'Fun',
    description: 'Get a random SFW anime husby image',
    usage: '.husby',
    async handler(sock, msg) {
      await fetchAndSend(sock, msg, 'https://api.shizo.top/sfw/husbando?apikey=shizo', 'Random Husby', '💙');
    }
  }
];
