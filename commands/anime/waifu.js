const axios = require('axios');

module.exports = {
  name: 'waifu',
  aliases: ['randomwaifu'],
  category: 'anime',
  description: 'Get a random SFW waifu image',
  usage: '.waifu',

  async execute(sock, msg, args, extra) {
    await extra.react('✨');
    try {
      const res = await axios.get('https://api.shizo.top/sfw/waifu?apikey=shizo', { timeout: 10000 });
      const data = res.data;

      const imageUrl =
        data?.url ||
        data?.image ||
        data?.image_url ||
        null;

      if (!imageUrl) {
        return await extra.reply('❌ Could not fetch waifu image. Try again!');
      }

      await sock.sendMessage(msg.key.remoteJid, {
        image: { url: imageUrl },
        caption: '✨ *Random Waifu*'
      }, { quoted: msg });

      await extra.react('✅');
    } catch (e) {
      await extra.react('❌');
      await extra.reply(`❌ Error: ${e.message}`);
    }
  }
};
