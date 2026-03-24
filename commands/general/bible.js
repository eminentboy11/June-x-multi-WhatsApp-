const { keithApi } = require('../../utils/keithApi');

module.exports = {
  name: 'bible',
  aliases: ['verse', 'scripture'],
  category: 'general',
  description: 'Search Bible chapters and verses',
  usage: '.bible <reference>',

  async execute(sock, msg, args, extra) {
    if (!args.length) return extra.reply('❌ Provide a Bible reference.\n\nExample: *.bible john 3:16-18*');
    await extra.react('📖');
    try {
      const data = await keithApi('/search/bible', { q: args.join(' ') });
      const r = data.result || data;
      let text = `📖 *Bible: ${args.join(' ')}*\n━━━━━━━━━━━━━━━\n\n`;
      if (typeof r === 'string') { text += r; }
      else if (Array.isArray(r)) {
        for (const v of r) {
          text += `${v.verse || v.reference || ''}: ${v.text || v.content || ''}\n\n`;
        }
      } else {
        text += JSON.stringify(r, null, 2).slice(0, 3000);
      }
      await extra.reply(text.trim());
    } catch (e) {
      await extra.reply(`❌ Bible search error: ${e.message}`);
    }
  }
};
