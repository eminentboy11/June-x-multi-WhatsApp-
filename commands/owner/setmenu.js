/**
 * SetMenu Command - Owner only
 * Change the menu display style (1-6)
 * Settings stored in SQLite via utils/settings (bot_settings table).
 */

const settings = require('../../utils/settings');

const MENU_STYLES = {
  '1': '  Document with thumbnail ad reply',
  '2': '  Simple text reply',
  '3': '  Text with external ad reply',
  '4': '  Image with caption',
  '5': '  Interactive native flow message',
  '6': '  Payment request style'
};

function box(lines) {
  let text = `╭━━『 *Menu Style Settings* 』━━╮\n\n`;
  text += lines.join('\n');
  text += `\n\n╰━━━━━━━━━━━━━━━━━━━━━━━╯`;
  return text;
}

module.exports = {
  name: 'setmenu',
  aliases: ['menustyle', 'menuset'],
  category: 'owner',
  description: 'Set the menu display style (1-6)',
  usage: '.setmenu <1-6>',
  ownerOnly: true,
  adminOnly: false,
  groupOnly: false,
  botAdminOnly: false,

  async execute(sock, msg, args, extra) {
    try {
      const style = args[0];

      if (!style) {
        const current = settings.get('menuStyle') || '1';
        const lines = [`📌 *Current Style:* ${current} — ${MENU_STYLES[current]}`, '', `*Available Styles:*`];
        for (const [num, desc] of Object.entries(MENU_STYLES)) {
          lines.push(`  *${num}.* ${desc}${num === current ? ' ✅' : ''}`);
        }
        lines.push('', `💡 Usage: *.setmenu <1-6>*`);
        return extra.reply(box(lines));
      }

      if (!['1', '2', '3', '4', '5', '6'].includes(style)) {
        return extra.reply(box([
          `❌ *Invalid style!*`,
          '',
          `Please choose a number between *1* and *6*.`,
          `Example: *.setmenu 3*`
        ]));
      }

      settings.set('menuStyle', style);

      await extra.reply(box([
        `✅ *Menu style set to Style ${style}!*`,
        '',
        `📋 ${MENU_STYLES[style]}`,
        '',
        `Send *.menu* to preview the new style.`
      ]));

    } catch (error) {
      console.error('SetMenu command error:', error);
      await extra.reply(box([`❌ *Failed to set menu style*`, '', `${error.message}`]));
    }
  }
};
