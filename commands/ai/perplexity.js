const { keithApi } = require(require('path').join(global.__CORE__, 'utils', 'keithApi'));

module.exports = {
  name: 'perplexity',
  aliases: ['pplx'],
  category: 'ai',
  description: 'Chat with Perplexity AI',
  usage: '.perplexity <question>',

  async execute(sock, msg, args, extra) {
    if (!args.length) return extra.reply('❌ Please provide a question.\n\nExample: *.perplexity Latest tech news*');
    await extra.react('🔮');
    try {
      const data = await keithApi('/ai/perplexity', { q: args.join(' ') });
      await extra.reply(data.result || '❌ No response received.');
    } catch (e) {
      await extra.reply(`❌ Perplexity error: ${e.message}`);
    }
  }
};
