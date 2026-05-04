const { keithApi } = require(require('path').join(global.__CORE__, 'utils', 'keithApi'));

module.exports = {
  name: 'deepseek',
  aliases: ['deepseekr1', 'dsk'],
  category: 'ai',
  description: 'Chat with Deepseek R1 AI',
  usage: '.deepseek <question>',

  async execute(sock, msg, args, extra) {
    if (!args.length) return extra.reply('❌ Please provide a question.\n\nExample: *.deepseek Solve x² + 5x + 6 = 0*');
    await extra.react('🔍');
    try {
      const data = await keithApi('/ai/deepseek', { q: args.join(' ') });
      await extra.reply(data.result || '❌ No response received.');
    } catch (e) {
      await extra.reply(`❌ Deepseek error: ${e.message}`);
    }
  }
};
