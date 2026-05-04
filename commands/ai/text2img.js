const { keithApi } = require(require('path').join(global.__CORE__, 'utils', 'keithApi'));
const axios = require('axios');

module.exports = {
  name: 'text2img',
  aliases: ['imagine', 'generate', 'img'],
  category: 'ai',
  description: 'Generate an image from text description',
  usage: '.text2img <description>',

  async execute(sock, msg, args, extra) {
    if (!args.length) return extra.reply('❌ Describe the image you want.\n\nExample: *.text2img a sunset over mountains*');
    await extra.react('🎨');
    try {
      const data = await keithApi('/ai/text2img', { q: args.join(' ') });
      const imageUrl = data.result?.url || data.result || data.url;
      if (!imageUrl) throw new Error('No image generated');

      const resp = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
      await sock.sendMessage(extra.from, {
        image: Buffer.from(resp.data),
        caption: `🎨 *Generated:* ${args.join(' ')}`
      }, { quoted: msg });
    } catch (e) {
      await extra.reply(`❌ Image generation error: ${e.message}`);
    }
  }
};
