/**
 * Invite Command
 * Sends the current group's invite link to a phone number via DM.
 * Usage: .invite 254798952773
 */

const config = require('../../config');

module.exports = {
  name: 'invite',
  aliases: ['invitelink', 'sendinvite'],
  category: 'owner',
  description: 'Send the group invite link to a phone number via DM',
  usage: '.invite <number>',
  ownerOnly: true,

  async execute(sock, msg, args, extra) {
    const { from, reply, react } = extra;

    if (!from.endsWith('@g.us')) {
      return reply('❌ This command can only be used inside a group.');
    }

    if (!args[0]) {
      return reply(`❌ *Usage:* ${config.prefix}invite <number>\n\nExample: ${config.prefix}invite 254798952773`);
    }

    const number = args[0].replace(/\D/g, '');
    if (number.length < 7) {
      return reply('❌ Invalid phone number. Include the country code, e.g. 254798952773');
    }

    const targetJid = `${number}@s.whatsapp.net`;

    try {
      const code = await sock.groupInviteCode(from);
      const link = `https://chat.whatsapp.com/${code}`;

      let groupName = 'this group';
      try {
        const meta = await sock.groupMetadata(from);
        groupName = meta.subject || 'this group';
      } catch (_) {}

      await sock.sendMessage(targetJid, {
        text:
          `👋 You've been invited to join *${groupName}*!\n\n` +
          `🔗 *Group Link:*\n${link}\n\n` +
          `> Sent via ${config.botName || 'June-X Ultra'}`
      });

      await react('✅');
      await reply(`✅ Invite link sent to *+${number}* for *${groupName}*.`);

    } catch (error) {
      console.error('[invite] Error:', error);
      if (error.message?.includes('not-authorized') || error.message?.includes('forbidden')) {
        return reply('❌ Bot must be a group admin to fetch the invite link.');
      }
      await reply(`❌ Failed to send invite: ${error.message}`);
    }
  }
};
