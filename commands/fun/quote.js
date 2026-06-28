const axios = require('axios');

module.exports = {
  name: 'quotes',
  aliases: ['randomfact'],
  category: 'fun',
  description: 'Get a random fact or quote',
  usage: '.fact',

  async execute(sock, msg, args, extra) {
    await extra.react('💡');
    try {
      const { data } = await axios.get('https://api.shizo.top/quote/quotes?apikey=shizo');

      if (!data.status || !data.result) {
        throw new Error('No result returned.');
      }

      await extra.reply(`💡 *Random Fact*\n\n_${data.result}_`);

      await extra.react('✅');
    } catch (e) {
      await extra.react('❌');
      await extra.reply(`❌ Error: ${e.message}`);
    }
  }
};
