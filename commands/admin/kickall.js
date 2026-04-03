/**
 * Kickall / Removeall / Killgc Command
 * Remove all non-bot members from the group.
 * killgc also makes the bot leave after removing everyone.
 */

module.exports = {
  name: 'kickall',
  aliases: ['removeall', 'killgc'],
  category: 'admin',
  description: 'Remove all members from the group. Use killgc to also make the bot leave.',
  usage: '.kickall | .removeall | .killgc',
  groupOnly: true,
  adminOnly: true,
  botAdminNeeded: true,

  async execute(sock, msg, args, extra) {
    try {
      const chatId = extra.from;
      const isKillGc = extra.command === 'killgc';

      const metadata = await sock.groupMetadata(chatId);
      const participants = metadata.participants || [];

      const botId = sock.user?.id || '';
      const botPhoneNumber = botId.includes(':')
        ? botId.split(':')[0]
        : botId.includes('@')
        ? botId.split('@')[0]
        : botId;

      const isBotParticipant = (p) => {
        const pPhone = (p.id || '').split('@')[0].split(':')[0];
        return pPhone === botPhoneNumber;
      };

      const toKick = participants.filter((p) => {
        if (isBotParticipant(p)) return false;
        return true;
      });

      if (toKick.length === 0) {
        return extra.reply('❌ No members to remove.');
      }

      await extra.reply(
        `⏳ Removing *${toKick.length}* member(s)... Please wait.`
      );

      const jids = toKick.map((p) => p.id);

      const chunkSize = 5;
      for (let i = 0; i < jids.length; i += chunkSize) {
        const chunk = jids.slice(i, i + chunkSize);
        await sock.groupParticipantsUpdate(chatId, chunk, 'remove');
        await new Promise((r) => setTimeout(r, 1500));
      }

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
