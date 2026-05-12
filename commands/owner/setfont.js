const { getCurrentFont, setCurrentFont, getFontList, FONTS, applyFont } = require('../../utils/fontConverter');

module.exports = {
  name: 'setfont',
  aliases: ['font', 'botfont'],
  category: 'owner',
  description: 'Set bot reply font style (20 styles). Does not affect links or @mentions.',
  usage: '.setfont <font name> or .setfont list',
  ownerOnly: true,

  async execute(sock, msg, args, extra) {
    try {
      const fonts = getFontList();

      if (!args.length || args[0].toLowerCase() === 'list') {
        const current = getCurrentFont();
        let text = `🖋️ *Bot Font Styles*\n━━━━━━━━━━━━━━━\n\n`;
        text += `Current: *${current}*\n\n`;
        fonts.forEach((name, i) => {
          const preview = applyFontPreview(name, 'Hello');
          const marker = name === current ? ' ✅' : '';
          text += `*${i + 1}.* ${name} — ${preview}${marker}\n`;
        });
        text += `\n━━━━━━━━━━━━━━━\nUsage: *${extra.prefix || '.'}setfont <name>*\nExample: *${extra.prefix || '.'}setfont gothic*\nUse *${extra.prefix || '.'}setfont normal* to reset.`;
        return extra.reply(text);
      }

      let fontName = args[0].toLowerCase();

      if (/^\d+$/.test(fontName)) {
        const idx = parseInt(fontName) - 1;
        if (idx >= 0 && idx < fonts.length) {
          fontName = fonts[idx];
        } else {
          return extra.reply(`❌ Pick a number between 1 and ${fonts.length}.`);
        }
      }

      if (!FONTS[fontName]) {
        return extra.reply(`❌ Font "${fontName}" not found.\n\nUse *${extra.prefix || '.'}setfont list* to see all available fonts.`);
      }

      setCurrentFont(fontName);

      const preview = applyFontPreview(fontName, 'Bot font has been updated!');
      await extra.reply(`✅ Font set to *${fontName}*\n\nPreview: ${preview}`);

    } catch (error) {
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};

function applyFontPreview(fontName, text) {
  if (fontName === 'normal' || !FONTS[fontName]) return text;
  const font = FONTS[fontName];
  const NORMAL_LOWER = 'abcdefghijklmnopqrstuvwxyz';
  const NORMAL_UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const NORMAL_DIGITS = '0123456789';
  let result = '';
  for (const ch of text) {
    const lIdx = NORMAL_LOWER.indexOf(ch);
    if (lIdx !== -1) { result += [...font.lower][lIdx] || ch; continue; }
    const uIdx = NORMAL_UPPER.indexOf(ch);
    if (uIdx !== -1) { result += [...font.upper][uIdx] || ch; continue; }
    const dIdx = NORMAL_DIGITS.indexOf(ch);
    if (dIdx !== -1) { result += [...font.digits][dIdx] || ch; continue; }
    result += ch;
  }
  return result;
}
