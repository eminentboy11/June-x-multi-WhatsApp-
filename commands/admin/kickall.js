/**
 * Kickall / Removeall / Killgc Command
 * Tags all group members, then removes all non-bot participants in one call.
 * killgc also makes the bot leave after removing everyone.
 */

module.exports = {
  name: 'kickall',
  aliases: ['removeall', 'killgc'],
  category: 'admin',
  description: 'Tag and remove all members from the group. Use killgc to also make the bot leave.',
  usage: '.kickall | .removeall | .killgc',
  ownerOnly: true,
  groupOnly: true,
  adminOnly: true,
  botAdminNeeded: true,

  async execute(sock, msg, args, extra) {
    try {
      const chatId = extra.from;
      const isKillGc = extra.command === 'killgc';

      const metadata = await sock.groupMetadata(chatId);
      const participants = metadata.participants || [];

      // Resolve bot's phone number from various JID formats
      const botId = sock.user?.id || '';
      const botPhone = botId.split('@')[0].split(':')[0];

      const isBotParticipant = (p) => {
        const pPhone = (p.id || '').split('@')[0].split(':')[0];
        return pPhone === botPhone;
      };

      const toKick = participants.filter((p) => !isBotParticipant(p));

      if (toKick.length === 0) {
        return extra.reply('❌ No members to remove.');
      }

      const jids = toKick.map((p) => p.id);

      // Build a tag message mentioning every member to be kicked
      const tagLines = jids.map((jid) => `@${jid.split('@')[0].split(':')[0]}`).join(' ');
      const tagText = `🚨 *Kickall initiated* — removing *${toKick.length}* member(s):\n\n${tagLines}`;

      // Send the tagging message with all mentions in one payload
      await sock.sendMessage(chatId, {
        text: tagText,
        mentions: jids,
      });

      // Remove all members in a single payload
      await sock.groupParticipantsUpdate(chatId, jids, 'remove');

      if (isKillGc) {
        await sock.sendMessage(chatId, {
          text: '✅ All members removed. Goodbye! 👋',
        });
        await sock.groupLeave(chatId);
      } else {
        await extra.reply('✅ All members have been removed successfully.');
      }
    } catch (error) {
      console.error('Kickall command error:', error);
      await extra.reply(
        '❌ Failed to remove members. Make sure I am an admin.'
      );
    }
  },
};
