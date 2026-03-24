const { keithApi } = require('../../utils/keithApi');

module.exports = {
  name: 'nhie',
  aliases: ['neverhaveiever'],
  category: 'fun',
  description: 'Never have I ever question',
  usage: '.nhie',

  async execute(sock, msg, args, extra) {
    await extra.react('🙈');
    try {
      const data = await keithApi('/fun/never-have-i-ever');
      await extra.reply(`🙈 *Never Have I Ever...*\n\n${data.result || JSON.stringify(data)}`);
    } catch (e) {
      await extra.reply(`❌ Error: ${e.message}`);
    }
  }
};
