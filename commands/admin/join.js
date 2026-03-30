/**
 * Join Command
 * Makes the bot join a WhatsApp group via invite link
 * Usage: .join https://chat.whatsapp.com/XXXXXX
 */

module.exports = {
  name: 'join',
  aliases: [],
  category: 'admin',
  description: 'Make the bot join a group via invite link',
  usage: '.join https://chat.whatsapp.com/XXXXXX',
  ownerOnly: true,

  async execute(sock, msg, args, extra) {
    try {
      if (!args || args.length === 0) {
        return extra.reply('🔗 Please provide a group invite link.\n\nExample: .join https://chat.whatsapp.com/XXXXXX');
      }

      const link = args[0].trim();

      const match = link.match(/chat\.whatsapp\.com\/([A-Za-z0-9_-]+)/);
      if (!match) {
        return extra.reply('❌ Invalid invite link. It should look like:\nhttps://chat.whatsapp.com/XXXXXX');
      }

      const inviteCode = match[1];

      await sock.sendMessage(extra.from, { react: { text: '⏳', key: msg.key } });

      const groupId = await sock.groupAcceptInvite(inviteCode);

      await sock.sendMessage(extra.from, { react: { text: '✅', key: msg.key } });

      await extra.reply(`✅ Successfully joined the group!\n🔗 Group ID: ${groupId}`);
    } catch (error) {
      console.error('Join command error:', error);
      await sock.sendMessage(extra.from, { react: { text: '❌', key: msg.key } }).catch(() => {});

      if (error.message?.includes('not-authorized') || error.message?.includes('401')) {
        return extra.reply('❌ This invite link is invalid or has expired.');
      }
      if (error.message?.includes('406')) {
        return extra.reply('❌ The bot is already a member of this group.');
      }
      await extra.reply('❌ Failed to join the group. The link may be invalid or expired.');
    }
  }
};
