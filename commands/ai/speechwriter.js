const { keithApi } = require(require('path').join(global.__CORE__, 'utils', 'keithApi'));

module.exports = {
  name: 'speechwriter',
  aliases: ['writespeech', 'speech'],
  category: 'ai',
  description: 'AI speech writer — generates a speech on your topic',
  usage: '.speechwriter <topic>',

  async execute(sock, msg, args, extra) {
    if (!args.length) return extra.reply('❌ Provide a topic for the speech.\n\nExample: *.speechwriter importance of education*');
    await extra.react('📝');
    try {
      const data = await keithApi('/ai/speechwriter', { topic: args.join(' '), length: 'medium', type: 'general', tone: 'formal' });
      await extra.reply(`📝 *Speech: ${args.join(' ')}*\n\n${data.result || '❌ No speech generated.'}`);
    } catch (e) {
      await extra.reply(`❌ Speech writer error: ${e.message}`);
    }
  }
};
