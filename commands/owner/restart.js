/**
 * Restart Command - Restart bot (Owner Only)
 */

module.exports = {
  name: 'restart',
  aliases: ['reboot', 'reload'],
  category: 'owner',
  description: 'Restart the bot (Owner Only)',
  usage: '.restart',
  ownerOnly: true,

  async execute(sock, msg, args, extra) {
    try {
      await extra.reply('🔁 Restarting bot...');

      // Exit with code 1 so nodemon triggers an automatic restart
      setTimeout(() => {
        process.exit(1);
      }, 500);
    } catch (error) {
      console.error('Restart error:', error);
      await extra.reply(`❌ Error restarting bot: ${error.message}`);
    }
  },
};
