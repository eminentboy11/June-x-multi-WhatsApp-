const axios = require('axios');

module.exports = {
  name: 'imagine',
  aliases: ['magic', 'magicai', 'magicstudio', 'generate'],
  category: 'ai',
  desc: 'Generate AI art from text prompt',
  usage: '.imagine <prompt>',
  execute: async (sock, msg, args, extra) => {
    const prompt = args.join(' ').trim();
    if (!prompt) {
      return await extra.reply('Usage: .imagine <prompt>\n\nExample: .imagine a cyberpunk city at night');
    }

    await extra.react('🎨');

    try {
      const response = await axios.get('https://apiskeith.top/ai/magicstudio', {
        params: { prompt },
        responseType: 'arraybuffer',
        timeout: 120000,
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': '*/*' }
      });

      const imageBuffer = Buffer.from(response.data);
      if (!imageBuffer || imageBuffer.length === 0) throw new Error('Empty response from API');

      await sock.sendMessage(extra.from, {
        image: imageBuffer,
        caption: `🎨 *Generated:* ${prompt}`
      }, { quoted: msg });

    } catch (error) {
      if (error.response?.status === 429) {
        await extra.reply('❌ Rate limit exceeded. Please try again later.');
      } else if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        await extra.reply('❌ Request timed out. Image generation is taking too long. Try again.');
      } else {
        await extra.reply(`❌ Failed to generate image: ${error.message}`);
      }
    }
  }
};
