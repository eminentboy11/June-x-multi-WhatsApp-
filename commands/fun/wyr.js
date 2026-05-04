const { keithApi } = require(require('path').join(global.__CORE__, 'utils', 'keithApi'));

module.exports = {
  name: 'wyr',
  aliases: ['wouldyourather'],
  category: 'fun',
  description: 'Would you rather question',
  usage: '.wyr',

  async execute(sock, msg, args, extra) {
    await extra.react('🤔');
    try {
      const data = await keithApi('/fun/would-you-rather');
      await extra.reply(`🤔 *Would You Rather...*\n\n${data.result || JSON.stringify(data)}`);
    } catch (e) {
      await extra.reply(`❌ Error: ${e.message}`);
    }
  }
};
