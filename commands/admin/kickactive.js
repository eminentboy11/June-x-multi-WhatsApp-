/**
 * Kickactive Command
 * Removes every group member who has tracked message activity.
 * Activity is tracked via utils/groupstats.js -> addMessage on every message.
 */

const { getActiveUsers } = require(require('path').join(global.__CORE__, 'utils', 'groupstats'));

module.exports = {
  name: 'kickactive',
  aliases: ['removeactive', 'kickchatty', 'kickact'],
  category: 'admin',
  description: 'Remove all active members (who have sent messages) from the group',
  usage: '.kickactive',
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

      // Pull every JID that has ever been recorded as active in this group
      const activeList = getActiveUsers(chatId, 9999);
      const activeSet = new Set(activeList.map(a => a.jid));

      // A participant is active if EITHER their id OR lid appears in active set
      const toKick = participants.filter(p => {
        if (isBot(p.id) || isBot(p.lid)) return false;
        if (adminIds.has(p.id)) return false;
        return activeSet.has(p.id) || (p.lid && activeSet.has(p.lid));
      });

      if (toKick.length === 0) {
        await extra.react('✅');
        return extra.reply('✅ No active members to remove. No tracked activity yet.');
      }

      const jids = toKick.map(p => p.id);
      const tagLines = jids.map(jid => `@${jid.split('@')[0].split(':')[0]}`).join(' ');

      await sock.sendMessage(chatId, {
        text: `🚨 *Removing ${toKick.length} active member(s)*:\n\n${tagLines}`,
        mentions: jids,
      });

      await sock.groupParticipantsUpdate(chatId, jids, 'remove');

      await extra.react('✅');
      await sock.sendMessage(chatId, {
        text: `✅ Removed *${toKick.length}* active member(s) successfully.`,
      }, { quoted: msg });
    } catch (error) {
      console.error('Kickactive command error:', error);
      try { await extra.react('❌'); } catch (_) {}
      await extra.reply('❌ Failed to remove active members. Make sure I am admin.');
    }
  },
};
