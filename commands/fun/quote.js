const axios = require('axios');

module.exports = {
  name: 'quote',
  aliases: ['randomquote', 'motivation'],
  category: 'fun',
  description: 'Get a random inspirational quote',
  usage: '.quote',

  async execute(sock, msg, args, extra) {
    await extra.react('💬');
    try {
      const { data } = await axios.get('https://api.quotable.io/random');

      const text =
        `💬 _"${data.content}"_\n\n` +
        `— *${data.author}*`;

      await extra.reply(text);
    } catch (e) {
      await extra.reply(`❌ Error: ${e.message}`);
    }
  }
};
