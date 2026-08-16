module.exports = {
  name: 'restart',
  aliases: ['reload'],
  category: 'owner',
  description: 'Restart the bot (Owner Only)',
  usage: '.restart',
  ownerOnly: true,

  async execute(sock, msg, args, extra) {
    try {
      const chatJid = msg.key.remoteJid;
      await extra.reply('🔁 Restarting bot...');
      // an automatic restart.
      setTimeout(() => {
        process.exit(1);
      }, 500);
    } catch (error) {
      console.error('Restart error:', error);
      await extra.reply(`❌ Error restarting bot: ${error.message}`);
    }
  },
};
