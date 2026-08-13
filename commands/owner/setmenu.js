'use strict';

/**
 * SetMenu Command — owner only
 *
 * Menu presentation settings are stored only in SQLite through database.js.
 */

const database = require('../../database');

const MENU_STYLES = {
  '1': 'Document with thumbnail ad reply',
  '2': 'Simple text reply',
  '3': 'Text with external ad reply',
  '4': 'Image with caption',
  '5': 'Interactive native flow message',
  '6': 'Payment request style',
};

const DISPLAY_OPTIONS = {
  memory:   { key: 'showMemory',      label: 'Memory usage' },
  uptime:   { key: 'showUptime',      label: 'Uptime' },
  plugins:  { key: 'showPluginCount', label: 'Command count' },
  progress: { key: 'showProgressBar', label: 'RAM progress bar' },
};

const flag = (enabled) => enabled ? '✅ ON' : '❌ OFF';

function box(lines) {
  let text = `╭━━『 *Menu Style Settings* 』━━╮\n\n`;
  text += lines.join('\n');
  text += `\n\n╰━━━━━━━━━━━━━━━━━━━━━━━╯`;
  return text;
}

function settingsLines(current) {
  return [
    `📌 *Current Style:* ${current.menuStyle} — ${MENU_STYLES[current.menuStyle]}`,
    '',
    '*Menu Details:*',
    `  • Memory: ${flag(current.showMemory)}`,
    `  • Uptime: ${flag(current.showUptime)}`,
    `  • Commands: ${flag(current.showPluginCount)}`,
    `  • Progress Bar: ${flag(current.showProgressBar)}`,
  ];
}

module.exports = {
  name: 'setmenu',
  aliases: ['menustyle', 'menuset'],
  category: 'owner',
  description: 'Set menu style and display details',
  usage: '.setmenu <1-6> | .setmenu <memory|uptime|plugins|progress> <on|off>',
  ownerOnly: true,
  adminOnly: false,
  groupOnly: false,
  botAdminOnly: false,

  async execute(sock, msg, args, extra) {
    try {
      const first = String(args[0] || '').trim().toLowerCase();
      const second = String(args[1] || '').trim().toLowerCase();
      const prefix = database.getBotSetting('prefix') || '.';

      if (!first || first === 'status') {
        const current = database.getMenuSettings();
        const lines = settingsLines(current);
        lines.push('', '*Available Styles:*');
        for (const [style, description] of Object.entries(MENU_STYLES)) {
          lines.push(`  *${style}.* ${description}${style === current.menuStyle ? ' ✅' : ''}`);
        }
        lines.push(
          '',
          `💡 Style: *${prefix}setmenu <1-6>*`,
          `💡 Details: *${prefix}setmenu memory on*`,
          `   Options: memory, uptime, plugins, progress`
        );
        return extra.reply(box(lines));
      }

      if (database.MENU_STYLE_VALUES.includes(first)) {
        database.updateMenuSettings({ menuStyle: first });
        return extra.reply(box([
          `✅ *Menu style set to Style ${first}!*`,
          '',
          `📋 ${MENU_STYLES[first]}`,
          '',
          `Send *${prefix}menu* to preview the new style.`,
        ]));
      }

      const option = DISPLAY_OPTIONS[first];
      if (option) {
        if (!['on', 'off'].includes(second)) {
          return extra.reply(box([
            `⚠️ Choose *on* or *off* for ${option.label}.`,
            '',
            `Example: *${prefix}setmenu ${first} on*`,
          ]));
        }

        const enabled = second === 'on';
        database.updateMenuSettings({ [option.key]: enabled });
        return extra.reply(box([
          `✅ *${option.label}* is now ${flag(enabled)}.`,
          '',
          `Send *${prefix}menu* to preview the change.`,
        ]));
      }

      return extra.reply(box([
        '❌ *Invalid menu setting!*',
        '',
        `Choose a style from *1* to *6*, or use one of:`,
        '*memory*, *uptime*, *plugins*, *progress*',
      ]));
    } catch (error) {
      console.error('SetMenu command error:', error);
      await extra.reply(box(['❌ *Failed to update menu settings*', '', error.message]));
    }
  },
};
