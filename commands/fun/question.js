const { keithApi } = require('../../utils/keithApi');

module.exports = {
  name: 'question',
  aliases: ['randomq'],
  category: 'fun',
  description: 'Get a random question',
  usage: '.question',

  async execute(sock, msg, args, extra) {
    await extra.react('❓');
    try {
      const data = await keithApi('/fun/question');
      await extra.reply(`❓ *Random Question*\n\n${data.result || JSON.stringify(data)}`);
    } catch (e) {
      await extra.reply(`❌ Error: ${e.message}`);
    }
  }
};
