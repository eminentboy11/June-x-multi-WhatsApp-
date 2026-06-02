/**
 * Anti-Call Command — Enable or disable anti-call with configurable action
 *
 * Modes:
 *   off      — Allow all calls
 *   decline  — Auto-decline incoming calls
 *   block    — Auto-decline and block the caller
 *   on       — Same as block (decline + block)
 */

const fs = require('fs');
const path = require('path');
const configPath = path.join(__dirname, '../../config.js');

module.exports = {
  name: 'anticall',
  aliases: ['ac'],
  category: 'owner',
  ownerOnly: true,
  description: 'Configure anti-call system (off, decline, block, on)',
  usage: '.anticall off|decline|block|on',

  async execute(sock, msg, args, extra) {
    if (!args[0]) {
      return extra.reply(
        `🛡️ *Anti-Call Settings*\n\n` +
        `Usage: .anticall <off|decline|block|on>\n\n` +
        `• *off*     — Allow all calls\n` +
        `• *decline* — Auto-decline calls\n` +
        `• *block*   — Decline + block caller\n` +
        `• *on*      — Same as block\n\n` +
        `_Current: ${require('../../config').defaultGroupSettings.anticall ? 'enabled' : 'disabled'}_`
      );
    }

    const option = args[0].toLowerCase().trim();
    const valid = ['off', 'decline', 'block', 'on'];

    if (!valid.includes(option)) {
      return extra.reply('❌ Invalid option. Use: *off*, *decline*, *block*, or *on*.');
    }

    const enabled = option !== 'off';
    const action = enabled ? (option === 'decline' ? 'decline' : 'block') : 'decline';

    try {
      let configFile = fs.readFileSync(configPath, 'utf8');

      // Update anticall: false/true
      configFile = configFile.replace(
        /anticall:\s*(true|false)/,
        `anticall: ${enabled}`
      );

      // Update anticallAction
      const hasAction = configFile.includes('anticallAction');
      if (hasAction) {
        configFile = configFile.replace(
          /anticallAction:\s*['"]([^'"]+)['"]/,
          `anticallAction: '${action}'`
        );
      } else {
        configFile = configFile.replace(
          /anticall:\s*(true|false)/,
          `anticall: ${enabled},\n      anticallAction: '${action}'`
        );
      }

      fs.writeFileSync(configPath, configFile);
      delete require.cache[require.resolve('../../config')];

      if (option === 'off') {
        await extra.reply('❌ Anti-call *disabled* — all calls are allowed.');
      } else if (option === 'decline') {
        await extra.reply('✅ Anti-call set to *decline* — calls will be auto-declined.');
      } else {
        await extra.reply('✅ Anti-call set to *block* — calls will be auto-declined and the caller blocked.');
      }
    } catch (err) {
      console.error('[anticall cmd] error:', err);
      extra.reply('❌ Error updating anti-call setting.');
    }
  }
};