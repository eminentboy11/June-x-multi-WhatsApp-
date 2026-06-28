const axios = require('axios');

module.exports = {
  name: 'pickupline',
  aliases: ['rizz'],
  category: 'fun',
  description: 'Get a random pickup line',
  usage: '.pickupline',

  async execute(sock, msg, args, extra) {
    await extra.react('😏');
    try {
      const { data } = await axios.get('https://api.jcwyt.com/pickup');

      // API returns plain text or { line: "..." }
      const line = typeof data === 'string' ? data : (data.line || data.pickup || JSON.stringify(data));

      await extra.reply(`😏 *Pickup Line*\n\n_${line}_`);
    } catch (e) {
      await extra.reply(`❌ Error: ${e.message}`);
    }
  }
};
