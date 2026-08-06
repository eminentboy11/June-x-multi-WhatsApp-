/**
 * SetMenu Command - Owner only
 * Change the menu display style (1-6)
 */

const fs       = require('fs');
const path     = require('path');
const settings = require('../../utils/settings');

const MENU_SETTINGS_FILE = path.join(__dirname, '../../data/menuSettings.json');

const MENU_STYLES = {
  '1': '  Document with thumbnail ad reply',
  '2': '  Simple text reply',
  '3': '  Text with external ad reply',
  '4': '  Image with caption',
  '5': '  Interactive native flow message',
  '6': '  Payment request style'
};

function getSettings() {
  try {
    if (!fs.existsSync(MENU_SETTINGS_FILE)) {
      const defaults = { menuStyle: '2', showMemory: true, showUptime: true, showPluginCount: true, showProgressBar: true };
      fs.mkdirSync(path.dirname(MENU_SETTINGS_FILE), { recursive: true });
      fs.writeFileSync(MENU_SETTINGS_FILE, JSON.stringify(defaults, null, 2));
      return defaults;
    }
    return JSON.parse(fs.readFileSync(MENU_SETTINGS_FILE, 'utf8'));
  } catch {
    return { menuStyle: '2' };
  }
}

function saveSettings(data) {
  fs.mkdirSync(path.dirname(MENU_SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(MENU_SETTINGS_FILE, JSON.stringify(data, null, 2));
}

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
        const current = getSettings().menuStyle || '1';
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

      const menuSettings = getSettings();
      menuSettings.menuStyle = style;
      saveSettings(menuSettings);
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
