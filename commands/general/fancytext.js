const { keithApi } = require('../../utils/keithApi');

const STYLE_COUNT = 45;

module.exports = {
  name: 'fancy',
  aliases: ['fancytext', 'stylish'],
  category: 'general',
  description: 'Convert text to fancy/stylish fonts. Reply with a number to pick a style.',
  usage: '.fancy <text> or .fancy <number> (reply to fancy list)',

  async execute(sock, msg, args, extra) {
    const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const quotedText = quotedMsg?.conversation || quotedMsg?.extendedTextMessage?.text || '';

    if (quotedText.includes('Fancy Text Styles') && args.length === 1 && /^\d+$/.test(args[0])) {
      const styleNum = parseInt(args[0]);
      if (styleNum < 1 || styleNum > STYLE_COUNT) {
        return extra.reply(`❌ Pick a number between 1 and ${STYLE_COUNT}.`);
      }

      const lines = quotedText.split('\n').filter(l => l.startsWith('*'));
      const match = lines.find(l => l.startsWith(`*${styleNum}.*`));
      if (match) {
        const fancyResult = match.replace(/^\*\d+\.\*\s*/, '');
        return extra.reply(fancyResult);
      }

      return extra.reply('❌ Could not find that style. Try again.');
    }

    let input = args.join(' ');

    if (!input && quotedText && !quotedText.includes('Fancy Text Styles')) {
      input = quotedText.trim();
    }

    if (!input) return extra.reply('❌ Provide text to stylize.\n\nExample: *.fancy Hello World*\nOr reply to a message with *.fancy*\n\nThen reply to the result with *.fancy <number>* to pick a style.');
    await extra.react('✨');
    try {

      const promises = [];
      for (let i = 0; i < STYLE_COUNT; i++) {
        promises.push(
          keithApi('/fancytext', { q: input, style: i })
            .then(data => ({ index: i, result: data.result }))
            .catch(() => null)
        );
      }

      const responses = await Promise.all(promises);

      let text = `✨ *Fancy Text Styles*\n━━━━━━━━━━━━━━━\n\n`;
      for (const r of responses) {
        if (r && r.result) {
          text += `*${r.index + 1}.* ${r.result}\n\n`;
        }
      }

      if (text.length < 50) {
        return extra.reply('❌ Could not generate fancy text. Try different input.');
      }

      text += `━━━━━━━━━━━━━━━\n_Reply to this message with a number to pick a style._`;

      await extra.reply(text.trim());
    } catch (e) {
      await extra.reply(`❌ Fancy text error: ${e.message}`);
    }
  }
};
