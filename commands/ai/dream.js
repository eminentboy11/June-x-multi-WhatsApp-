const { keithApi } = require(require('path').join(global.__CORE__, 'utils', 'keithApi'));

module.exports = {
  name: 'dream',
  aliases: ['dreamanalyzer', 'interpret'],
  category: 'ai',
  description: 'AI dream interpretation and analysis',
  usage: '.dream <describe your dream>',

  async execute(sock, msg, args, extra) {
    if (!args.length) return extra.reply('❌ Describe your dream.\n\nExample: *.dream I dreamt about flying over the ocean*');
    await extra.react('🌙');
    try {
      const data = await keithApi('/ai/dreamanalyzer', { q: args.join(' ') });
      await extra.reply(`🌙 *Dream Analysis*\n\n${data.result || '❌ No interpretation received.'}`);
    } catch (e) {
      await extra.reply(`❌ Dream analyzer error: ${e.message}`);
    }
  }
};
