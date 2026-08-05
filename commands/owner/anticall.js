'use strict';

const fs = require('fs');
const path = require('path');
const configPath = path.join(__dirname, '../../config.js');

module.exports = {
  name: 'anticall',
  aliases: ['ac'],
  category: 'owner',
  ownerOnly: true,
  description: 'Toggle anti-call system (off/decline/block)',
  usage: '.anticall <off|decline|block|on>',

  async execute(sock, msg, args, extra) {
    const option = args[0]?.toLowerCase().trim();
    const config = require('../../config');
    const current = config.defaultGroupSettings.anticall ? 'enabled' : 'disabled';

    if (!option) {
      return extra.reply(
        `📵 *Anti-Call System: ${current.toUpperCase()}*\n\n` +
        `*Toggle Commands:*\n` +
        `• \`.anticall off\` - Disable anti-call\n` +
        `• \`.anticall decline\` - Decline calls only\n` +
        `• \`.anticall block\` - Decline & block caller\n` +
        `• \`.anticall on\` - Enable (same as block)\n\n` +
        `_Type \`.anticallmsg\` for all message options._`
      );
    }

    const valid = ['off', 'decline', 'block', 'on'];

    if (!valid.includes(option)) {
      return extra.reply('⚠️ Usage: `.anticall off | decline | block | on`');
    }

    const enabled = option !== 'off';
    const action = option === 'decline' ? 'decline' : 'block';

    try {
      let configFile = fs.readFileSync(configPath, 'utf8');

      // Update anticall enabled/disabled
      configFile = configFile.replace(
        /anticall:\s*(true|false)/,
        `anticall: ${enabled}`
      );

      // Update action type
      if (configFile.includes('anticallAction')) {
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

      const replies = {
        off: {
          emoji: '📵',
          title: 'Anti-Call *OFF*',
          desc: 'Calls will be accepted normally.'
        },
        decline: {
          emoji: '📵',
          title: 'Anti-Call: *Decline Mode*',
          desc: 'Incoming calls will be automatically declined.\n_Manage messages with `.anticallmsg`_'
        },
        block: {
          emoji: '🚫',
          title: 'Anti-Call: *Block Mode*',
          desc: 'Incoming calls will be declined and caller blocked.\n_Customize message with `.anticallmsg set`_'
        },
        on: {
          emoji: '🚫',
          title: 'Anti-Call: *Block Mode* (Enabled)',
          desc: 'Incoming calls will be declined and caller blocked.\n_Use `.anticallmsg` to manage messages._'
        }
      };

      const reply = replies[option];
      return extra.reply(`✅ ${reply.emoji} ${reply.title}\n\n${reply.desc}`);

    } catch (err) {
      console.error('[anticall]', err.message);
      return extra.reply('❌ Failed to update anti-call setting.');
    }
  }
};
