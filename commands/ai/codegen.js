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
    const query = args.join(' ');
    try {
      let result;
      try {
        const data = await keithApi('/ai/codegen', { q: query });
        result = (typeof data.result === 'string') ? data.result : null;
        if (!result || data.result?.status === false) throw new Error('codegen unavailable');
      } catch {
        const fallback = await keithApi('/ai/gpt4', { q: `Write code for: ${query}` });
        result = fallback.result;
      }
      await extra.reply(result || '❌ No code generated.');
    } catch (e) {
      await extra.reply(`❌ Code generator error: ${e.message}`);
    }
  }
};
