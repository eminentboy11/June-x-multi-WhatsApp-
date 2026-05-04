/**
 * Kickinactive Command
 * Removes every group member who has zero tracked message activity.
 * Activity is tracked via utils/groupstats.js -> addMessage on every message.
 */

const { getInactiveUsers } = require(require('path').join(global.__CORE__, 'utils', 'groupstats'));

module.exports = {
  name: 'kickinactive',
  aliases: ['kickinnactive', 'removeinactive', 'kickidle', 'kickinact'],
  category: 'admin',
  description: 'Remove all inactive members (no tracked messages) from the group',
  usage: '.kickinactive',
  groupOnly: true,
  adminOnly: true,
  ownerOnly: true,
  botAdminNeeded: true,

  async execute(sock, msg, args, extra) {
    try {
      const chatId = extra.from;
      await extra.react('⏳');

      const metadata = await sock.groupMetadata(chatId);
      const participants = metadata.participants || [];

      // Resolve bot identity to skip
      const botId = sock.user?.id || '';
      const botLid = sock.user?.lid || '';
      const botPhone = botId.split('@')[0].split(':')[0];
      const botLidNum = botLid.split('@')[0].split(':')[0];

      const isBot = (jid) => {
        const phone = (jid || '').split('@')[0].split(':')[0];
        return phone === botPhone || (botLidNum && phone === botLidNum);
      };

      // Skip admins/superadmins (don't kick group leaders)
      const adminIds = new Set(
        participants
          .filter(p => p.admin === 'admin' || p.admin === 'superadmin')
          .map(p => p.id)
      );

      // Collect every JID variant (id + lid) that has been seen as active
      const allParticipantIds = participants.flatMap(p => [p.id, p.lid].filter(Boolean));
      const inactiveSet = new Set(getInactiveUsers(chatId, allParticipantIds));

      // A participant is inactive only if BOTH their id AND lid are inactive
      const toKick = participants.filter(p => {
        if (isBot(p.id) || isBot(p.lid)) return false;
        if (adminIds.has(p.id)) return false;
        const idInactive  = inactiveSet.has(p.id);
        const lidInactive = !p.lid || inactiveSet.has(p.lid);
        return idInactive && lidInactive;
      });

      if (toKick.length === 0) {
        await extra.react('✅');
        return extra.reply('✅ No inactive members to remove. Everyone has been active!');
      }

      const jids = toKick.map(p => p.id);
      const tagLines = jids.map(jid => `@${jid.split('@')[0].split(':')[0]}`).join(' ');

      await sock.sendMessage(chatId, {
        text: `🧹 *Removing ${toKick.length} inactive member(s)* (no message activity tracked):\n\n${tagLines}`,
        mentions: jids,
      });

      await sock.groupParticipantsUpdate(chatId, jids, 'remove');

      await extra.react('✅');
      await sock.sendMessage(chatId, {
        text: `✅ Removed *${toKick.length}* inactive member(s) successfully.`,
      }, { quoted: msg });
    } catch (error) {
      console.error('Kickinactive command error:', error);
      try { await extra.react('❌'); } catch (_) {}
      await extra.reply('❌ Failed to remove inactive members. Make sure I am admin.');
    }
  },
};
