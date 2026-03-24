const { keithApi } = require('../../utils/keithApi');

module.exports = {
  name: 'gemini',
  aliases: ['bard'],
  category: 'ai',
  description: 'Chat with Google Gemini AI',
  usage: '.gemini <question>',

  async execute(sock, msg, args, extra) {
    if (!args.length) return extra.reply('❌ Please provide a question.\n\nExample: *.gemini How does photosynthesis work?*');
    await extra.react('✨');
    try {
      const data = await keithApi('/ai/gemini', { q: args.join(' ') });
      await extra.reply(data.result || '❌ No response received.');
    } catch (e) {
      await extra.reply(`❌ Gemini error: ${e.message}`);
    }
  }
};
