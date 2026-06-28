const axios = require('axios');
const config = require('../../config');

const react = async (sock, msg, emoji) => {
  await sock.sendMessage(msg.key.remoteJid, {
    react: { text: emoji, key: msg.key }
  });
};

const fetchAndSend = async (sock, msg, { apiUrl, label, emoji }) => {
  const jid = msg.key.remoteJid;

  try {
    await react(sock, msg, emoji);

    const res = await axios.get(apiUrl, { timeout: 10000 });
    const data = res.data;

    const imageUrl =
      data?.url ||
      data?.image ||
      data?.image_url ||
      data?.data?.url ||
      data?.data?.image ||
      null;

    if (!imageUrl) {
      await react(sock, msg, '❌');
      return await sock.sendMessage(jid, {
        text: `❌ Could not fetch ${label} image. Try again!`
      }, { quoted: msg });
    }

    const caption =
      `${emoji} ${label}\n` +
      `━━━━━━━━━━━━━━━\n` +
      `🤖 ${config.botName}`;

    await sock.sendMessage(jid, {
      image: { url: imageUrl },
      caption,
      gifPlayback: false
    }, { quoted: msg });

    await react(sock, msg, '✅');

  } catch (err) {
    console.error(`[${label.toLowerCase()}] Error:`, err.message);
    await react(sock, msg, '❌');
    await sock.sendMessage(jid, {
      text: `❌ Failed to fetch ${label} image. Please try again later.`
    }, { quoted: msg });
  }
};

module.exports = [
  {
    name: 'neko',
    aliases: ['catgirl', 'nekogirl'],
    category: 'Fun',
    description: 'Get a random SFW neko (cat girl) image',
    usage: `${config.prefix}neko`,
    async handler(sock, msg) {
      await fetchAndSend(sock, msg, {
        apiUrl: 'https://api.shizo.top/sfw/neko?apikey=shizo',
        label: 'Random Neko',
        emoji: '🐱'
      });
    }
  },
  {
    name: 'waifu',
    aliases: ['randomwaifu', 'anime'],
    category: 'Fun',
    description: 'Get a random SFW waifu image',
    usage: `${config.prefix}waifu`,
    async handler(sock, msg) {
      await fetchAndSend(sock, msg, {
        apiUrl: 'https://api.shizo.top/sfw/waifu?apikey=shizo',
        label: 'Random Waifu',
        emoji: '✨'
      });
    }
  },
  {
    name: 'happy',
    aliases: ['animehappy'],
    category: 'Fun',
    description: 'Get a random SFW happy anime image',
    usage: `${config.prefix}happy`,
    async handler(sock, msg) {
      await fetchAndSend(sock, msg, {
        apiUrl: 'https://api.shizo.top/sfw/happy?apikey=shizo',
        label: 'Happy Anime',
        emoji: '😊'
      });
    }
  },
  {
    name: 'sad',
    aliases: ['animesad'],
    category: 'Fun',
    description: 'Get a random SFW sad anime image',
    usage: `${config.prefix}sad`,
    async handler(sock, msg) {
      await fetchAndSend(sock, msg, {
        apiUrl: 'https://api.shizo.top/sfw/sad?apikey=shizo',
        label: 'Sad Anime',
        emoji: '😢'
      });
    }
  },
  {
    name: 'husby',
    aliases: ['husband', 'animehusband', 'husbando'],
    category: 'Fun',
    description: 'Get a random SFW anime husby image',
    usage: `${config.prefix}husby`,
    async handler(sock, msg) {
      await fetchAndSend(sock, msg, {
        apiUrl: 'https://api.shizo.top/sfw/husbando?apikey=shizo',
        label: 'Random Husby',
        emoji: '💙'
      });
    }
  }
];
                         
