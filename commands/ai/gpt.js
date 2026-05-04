const { keithApi } = require(require('path').join(global.__CORE__, 'utils', 'keithApi'));

module.exports = {
  name: 'gpt',
  aliases: ['chatgpt', 'gpt4', 'ask'],
  category: 'ai',
  description: 'Chat with GPT-4 AI',
  usage: '.gpt <question>',

  async execute(sock, msg, args, extra) {
    if (!args.length) return extra.reply('❌ Please provide a question.\n\nExample: *.gpt What is quantum computing?*');
    await extra.react('🤖');
    try {
      const data = await keithApi('/ai/gpt4', { q: args.join(' ') });
      await extra.reply(data.result || '❌ No response received.');
    } catch (e) {
      await extra.reply(`❌ GPT error: ${e.message}`);
    }
  }
};
