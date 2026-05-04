const { keithApi } = require(require('path').join(global.__CORE__, 'utils', 'keithApi'));

module.exports = {
  name: 'meta',
  aliases: ['metaai', 'llama'],
  category: 'ai',
  description: 'Chat with Meta AI (LLaMA)',
  usage: '.meta <question>',

  async execute(sock, msg, args, extra) {
    if (!args.length) return extra.reply('❌ Please provide a question.\n\nExample: *.meta Tell me about Kenya*');
    await extra.react('🦙');
    try {
      const data = await keithApi('/ai/metai', { q: args.join(' ') });
      await extra.reply(data.result || '❌ No response received.');
    } catch (e) {
      await extra.reply(`❌ Meta AI error: ${e.message}`);
    }
  }
};
