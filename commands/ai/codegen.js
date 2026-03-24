const { keithApi } = require('../../utils/keithApi');

module.exports = {
  name: 'codegen',
  aliases: ['code', 'gencode'],
  category: 'ai',
  description: 'Generate code in any language',
  usage: '.codegen <description>',

  async execute(sock, msg, args, extra) {
    if (!args.length) return extra.reply('❌ Describe what code you need.\n\nExample: *.codegen generate a REST API in Python*');
    await extra.react('💻');
    try {
      const data = await keithApi('/ai/codegen', { q: args.join(' ') });
      await extra.reply(data.result || '❌ No response received.');
    } catch (e) {
      await extra.reply(`❌ Code generator error: ${e.message}`);
    }
  }
};
