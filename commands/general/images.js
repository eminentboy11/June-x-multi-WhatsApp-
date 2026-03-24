const { keithApi } = require('../../utils/keithApi');
const axios = require('axios');

module.exports = {
  name: 'images',
  aliases: ['imgsearch', 'gimage'],
  category: 'general',
  description: 'Search Google Images',
  usage: '.images <query>',

  async execute(sock, msg, args, extra) {
    if (!args.length) return extra.reply('❌ Provide a search query.\n\nExample: *.images cute cats*');
    await extra.react('🖼️');
    try {
      const data = await keithApi('/search/images', { q: args.join(' ') });
      const results = data.result || data.results || data;
      if (!Array.isArray(results) || !results.length) return extra.reply('❌ No images found.');

      const img = results[Math.floor(Math.random() * Math.min(results.length, 5))];
      const imgUrl = img.url || img.image || img.thumbnail || img;

      const resp = await axios.get(imgUrl, { responseType: 'arraybuffer', timeout: 15000 });
      await sock.sendMessage(extra.from, {
        image: Buffer.from(resp.data),
        caption: `🖼️ *${args.join(' ')}*`
      }, { quoted: msg });
    } catch (e) {
      await extra.reply(`❌ Image search error: ${e.message}`);
    }
  }
};
