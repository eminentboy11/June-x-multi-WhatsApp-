const { keithApi } = require('../../utils/keithApi');

module.exports = {
  name: 'fact',
  aliases: ['randomfact'],
  category: 'fun',
  description: 'Get a random interesting fact',
  usage: '.fact',

  async execute(sock, msg, args, extra) {
    await extra.react('🧠');
    try {
      const data = await keithApi('/fun/fact');
      await extra.reply(`🧠 *Random Fact*\n\n${data.result || JSON.stringify(data)}`);
    } catch (e) {
      await extra.reply(`❌ Error: ${e.message}`);
    }
  }
};
