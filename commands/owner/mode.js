/**
 * Mode Command
 * Set bot mode: public | private | group | pm
 */

const botMode = require('../../utils/botMode');

module.exports = [
  {
    name: 'mode',
    aliases: ['botmode', 'setmode'],
    description: 'Set bot operating mode (public / private / group / pm)',
    usage: '.mode <public|private|group|pm>',
    category: 'owner',
    ownerOnly: true,

    async execute(sock, msg, args, extra) {
      try {
        const current = botMode.getMode();

        if (!args[0]) {
          return extra.reply(
            `🤖 *Bot Mode*\n\n` +
            `Current Mode: *${botMode.getModeLabel()}*\n\n` +
            `*Available Modes:*\n` +
            `  🌐 *.mode public*  — everyone can use commands (groups & DMs)\n` +
            `  🔒 *.mode private* — only owner & sudo can use commands\n` +
            `  👥 *.mode group*   — commands work in groups only\n` +
            `  💬 *.mode pm*      — commands work in private chats only`
          );
        }

        await extra.react('⏳');

        const input = args[0].toLowerCase();

        const aliases = {
          pub: 'public',
          priv: 'private',
          grp: 'group',
          groups: 'group',
          dm: 'pm',
          dms: 'pm',
          inbox: 'pm'
        };

        const mode = aliases[input] || input;

        if (!botMode.VALID_MODES.includes(mode)) {
          await extra.react('❌');
          return extra.reply(
            `❌ *Invalid mode:* _${input}_\n\n` +
            `Choose one of: *public, private, group, pm*`
          );
        }

        if (mode === current) {
          await extra.react('✅');
          return extra.reply(`ℹ️ Bot is already in *${botMode.getModeLabel()}* mode.`);
        }

        botMode.setMode(mode);

        const descriptions = {
          public:  'Everyone can use commands in groups and DMs.',
          private: 'Only owner & sudo users can use commands.',
          group:   'Commands only work inside groups.',
          pm:      'Commands only work in private/DM chats.'
        };

        const icons = { public: '🌐', private: '🔒', group: '👥', pm: '💬' };

        await extra.react('✅');
        return extra.reply(
          `${icons[mode]} *Bot mode changed to ${mode.toUpperCase()}*\n\n` +
          `${descriptions[mode]}`
        );

      } catch (error) {
        console.error('[mode]', error.message);
        try { await extra.react('❌'); } catch (_) {}
        await extra.reply('❌ Error changing bot mode.');
      }
    }
  }
];
