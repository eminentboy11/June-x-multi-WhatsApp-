const { keithApi } = require(require('path').join(global.__CORE__, 'utils', 'keithApi'));

module.exports = {
  name: 'quote',
  aliases: ['randomquote', 'motivation'],
  category: 'fun',
  description: 'Get a random quote',
  usage: '.quote',

  async execute(sock, msg, args, extra) {
    await extra.react('💬');
    try {
      const data = await keithApi('/fun/quote');
      const r = data.result || data;
      if (typeof r === 'string') return extra.reply(`💬 ${r}`);
      await extra.reply(`💬 _"${r.quote || r.text || JSON.stringify(r)}"_\n\n— ${r.author || 'Unknown'}`);
    } catch (e) {
      await extra.reply(`❌ Error: ${e.message}`);
    }
  }
};
