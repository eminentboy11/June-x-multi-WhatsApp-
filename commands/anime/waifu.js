const axios = require('axios');
const { applyFont } = require('../../utils/fontConverter');
const config = require('../../config');

module.exports = [
  {
    name: 'waifu',
    aliases: ['randomwaifu', 'anime'],
    category: 'anime',
    description: 'Get a random SFW waifu image',
    usage: `${config.prefix}waifu`,

    async handler(sock, msg, args) {
      const jid = msg.key.remoteJid;

      const react = async (emoji) => {
        await sock.sendMessage(jid, {
          react: { text: emoji, key: msg.key }
        });
      };

      try {
        await react('🌸');

        const res = await axios.get('https://api.shizo.top/sfw/waifu?apikey=shizo', {
          timeout: 10000
        });

        const data = res.data;

        // Support common response shapes
        const imageUrl =
          data?.url ||
          data?.image ||
          data?.image_url ||
          data?.data?.url ||
          data?.data?.image ||
          null;

        if (!imageUrl) {
          await react('❌');
          return await sock.sendMessage(jid, {
            text: applyFont('❌ Could not fetch waifu image. Try again!', 'sans')
          }, { quoted: msg });
        }

        const caption =
          `${applyFont('✨ Random Waifu', 'bold')}\n` +
          `${applyFont('━━━━━━━━━━━━━━━', 'sans')}\n` +
          `${applyFont(`🤖 ${config.botName}`, 'sans')}`;

        await sock.sendMessage(jid, {
          image: { url: imageUrl },
          caption,
          gifPlayback: false
        }, { quoted: msg });

        await react('✅');

      } catch (err) {
        console.error('[waifu] Error:', err.message);
        await react('❌');
        await sock.sendMessage(jid, {
          text: applyFont('❌ Failed to fetch waifu image. Please try again later.', 'sans')
        }, { quoted: msg });
      }
    }
  }
];
