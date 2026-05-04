const { keithApi } = require(require('path').join(global.__CORE__, 'utils', 'keithApi'));

module.exports = {
  name: 'grok',
  aliases: ['grokai'],
  category: 'ai',
  description: 'Chat with Grok AI (xAI)',
  usage: '.grok <question>',

  async execute(sock, msg, args, extra) {
    if (!args.length) return extra.reply('❌ Please provide a question.\n\nExample: *.grok What is the meaning of life?*');
    await extra.react('⚡');
    try {
      const data = await keithApi('/ai/grok', { q: args.join(' ') });
      await extra.reply(data.result || '❌ No response received.');
    } catch (e) {
      await extra.reply(`❌ Grok error: ${e.message}`);
    }
  }
};
