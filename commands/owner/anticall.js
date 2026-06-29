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
    const current = require('../../config').defaultGroupSettings.anticall ? 'enabled' : 'disabled';

    if (!args[0]) {
      return extra.reply(`📵 Anti-Call: *${current}*\n\nUsage: .anticall off | decline | block | on`);
    }

    const option = args[0].toLowerCase().trim();
    const valid  = ['off', 'decline', 'block', 'on'];

    if (!valid.includes(option)) {
      return extra.reply('⚠️ Usage: .anticall off | decline | block | on');
    }

    const enabled = option !== 'off';
    const action  = option === 'decline' ? 'decline' : 'block';

    try {
      let configFile = fs.readFileSync(configPath, 'utf8');

      configFile = configFile.replace(
        /anticall:\s*(true|false)/,
        `anticall: ${enabled}`
      );

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
        off:     '📵 Anti-Call set to *OFF*.',
        decline: '📵 Anti-Call set to *Decline*.',
        block:   '🚫 Anti-Call set to *Block*.',
        on:      '🚫 Anti-Call set to *Block*.',
      };

      return extra.reply(replies[option]);

    } catch (err) {
      console.error('[anticall]', err.message);
      return extra.reply('❌ Failed to update anti-call setting.');
    }
  }
};
