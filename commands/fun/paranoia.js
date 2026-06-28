const axios = require('axios');

module.exports = {
  name: 'paranoia',
  aliases: [],
  category: 'fun',
  description: 'Get a random paranoia question',
  usage: '.paranoia',

  async execute(sock, msg, args, extra) {
    await extra.react('😱');
    try {
      const { data } = await axios.get('https://api.truthordarebot.xyz/v1/paranoia');

      const question = data.question || data.result || JSON.stringify(data);

      await extra.reply(`😱 *Paranoia*\n\n_${question}_`);
    } catch (e) {
      await extra.reply(`❌ Error: ${e.message}`);
    }
  }
};
