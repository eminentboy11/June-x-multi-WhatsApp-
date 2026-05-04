const { keithApi } = require(require('path').join(global.__CORE__, 'utils', 'keithApi'));

module.exports = {
  name: 'claude',
  aliases: ['claudeai'],
  category: 'ai',
  description: 'Chat with Claude AI',
  usage: '.claude <question>',

  async execute(sock, msg, args, extra) {
    if (!args.length) return extra.reply('❌ Please provide a question.\n\nExample: *.claude Explain relativity*');
    await extra.react('🧠');
    try {
      const data = await keithApi('/ai/claudeai', { q: args.join(' ') });
      await extra.reply(data.result || '❌ No response received.');
    } catch (e) {
      await extra.reply(`❌ Claude error: ${e.message}`);
    }
  }
};
