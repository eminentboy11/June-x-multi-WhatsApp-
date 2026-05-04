const { keithApi } = require(require('path').join(global.__CORE__, 'utils', 'keithApi'));

module.exports = {
  name: 'mistral',
  aliases: ['mistralai'],
  category: 'ai',
  description: 'Chat with Mistral AI',
  usage: '.mistral <question>',

  async execute(sock, msg, args, extra) {
    if (!args.length) return extra.reply('❌ Please provide a question.\n\nExample: *.mistral Explain machine learning*');
    await extra.react('🌀');
    try {
      const data = await keithApi('/ai/mistral', { q: args.join(' ') });
      await extra.reply(data.result || '❌ No response received.');
    } catch (e) {
      await extra.reply(`❌ Mistral error: ${e.message}`);
    }
  }
};
