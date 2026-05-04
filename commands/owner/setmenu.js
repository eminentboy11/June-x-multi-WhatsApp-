/**
 * SetMenu Command - Owner only
 * Change the menu display style (1-6)
 */

const fs       = require('fs');
const path     = require('path');
const settings = require(require('path').join(global.__CORE__, 'utils', 'settings'));

const MENU_SETTINGS_FILE = path.join(__dirname, '../../data/menuSettings.json');

const MENU_STYLES = {
  '1': '🗂️  Document with thumbnail ad reply',
  '2': '📄  Simple text reply',
  '3': '📋  Text with external ad reply',
  '4': '🖼️  Image with caption',
  '5': '🎛️  Interactive native flow message',
  '6': '💳  Payment request style'
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

module.exports = {
  name: 'setmenu',
  aliases: ['menustyle', 'changemenu'],
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
        let text = `╭━━『 *Menu Style Settings* 』━━╮\n\n`;
        text += `📌 *Current Style:* ${current} — ${MENU_STYLES[current]}\n\n`;
        text += `*Available Styles:*\n`;
        for (const [num, desc] of Object.entries(MENU_STYLES)) {
          text += `  *${num}.* ${desc}${num === current ? ' ✅' : ''}\n`;
        }
        text += `\n╰━━━━━━━━━━━━━━━━━━━━━━━╯\n`;
        text += `\n💡 Usage: *.setmenu <1-6>*`;
        return extra.reply(text);
      }

      if (!['1', '2', '3', '4', '5', '6'].includes(style)) {
        return extra.reply('❌ Invalid style! Please choose a number between *1* and *6*.\n\nExample: *.setmenu 3*');
      }

      const menuSettings = getSettings();
      menuSettings.menuStyle = style;
      saveSettings(menuSettings);
      settings.set('menuStyle', style);

      await extra.reply(`✅ Menu style has been set to *Style ${style}*!\n\n📋 ${MENU_STYLES[style]}\n\nSend *.menu* to preview the new style.`);

    } catch (error) {
      console.error('SetMenu command error:', error);
      await extra.reply(`❌ Failed to set menu style: ${error.message}`);
    }
  }
};
