module.exports = {
  name: 'delpp',
  aliases: ['deleteprofile', 'deppf', 'delprofilep', 'removedp'],
  category: 'owner',
  description: 'Remove the bot\'s profile picture',
  usage: '.delpp',

  async execute(sock, msg, args, extra) {
    try {
      if (!extra.isOwner) {
        return extra.reply('❌ This command is only available for the owner!');
      }

      await extra.react('⏳');

      const botJid = sock.user?.id || sock.user?.lid;
      if (!botJid) {
        await extra.react('❌');
        return extra.reply('❌ Could not determine bot JID.');
      }

      await sock.removeProfilePicture(botJid);

      await extra.react('✅');
      await sock.sendMessage(extra.from, {
        text: '✅ Successfully removed bot profile picture!',
      }, { quoted: msg });
    } catch (error) {
      console.error('Error in delpp command:', error);
      try { await extra.react('❌'); } catch (_) {}
      try { await extra.reply(`❌ Failed to remove profile picture: ${error.message}`); } catch (_) {}
    }
  },
};
