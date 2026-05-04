const { keithApi } = require(require('path').join(global.__CORE__, 'utils', 'keithApi'));

module.exports = {
  name: 'paranoia',
  aliases: [],
  category: 'fun',
  description: 'Get a random paranoia question',
  usage: '.paranoia',

  async execute(sock, msg, args, extra) {
    await extra.react('😱');
    try {
      const data = await keithApi('/fun/paranoia');
      await extra.reply(`😱 *Paranoia*\n\n${data.result || JSON.stringify(data)}`);
    } catch (e) {
      await extra.reply(`❌ Error: ${e.message}`);
    }
  }
};
