const { keithApi } = require(require('path').join(global.__CORE__, 'utils', 'keithApi'));

module.exports = {
  name: 'pickupline',
  aliases: ['rizz'],
  category: 'fun',
  description: 'Get a random pickup line',
  usage: '.pickupline',

  async execute(sock, msg, args, extra) {
    await extra.react('😏');
    try {
      const data = await keithApi('/fun/pickuplines');
      await extra.reply(`😏 *Pickup Line*\n\n${data.result || JSON.stringify(data)}`);
    } catch (e) {
      await extra.reply(`❌ Error: ${e.message}`);
    }
  }
};
