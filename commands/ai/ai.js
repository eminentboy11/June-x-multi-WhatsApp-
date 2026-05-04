const { keithApi } = require(require('path').join(global.__CORE__, 'utils', 'keithApi'));

module.exports = {
  name: 'ai',
  aliases: ['keithai'],
  category: 'ai',
  description: 'Chat with Keith AI (custom model)',
  usage: '.ai <question>',

  async execute(sock, msg, args, extra) {
    if (!args.length) return extra.reply('❌ Please provide a question.\n\nExample: *.ai What is the capital of France?*');
    await extra.react('🤖');
    try {
      const data = await keithApi('/keithai', { q: args.join(' ') });
      await extra.reply(data.result || '❌ No response received.');
    } catch (e) {
      await extra.reply(`❌ AI error: ${e.message}`);
    }
  }
};
