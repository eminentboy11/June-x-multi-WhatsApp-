// commands/getpp.js
const { tryFetchProfilePictureUrl, displayUserTag } = require('../../utils/helpers/jidHelper');

module.exports = {
  name: 'getpp',
  aliases: ['profilepic', 'pp', 'pfp'],
  category: 'general',
  description: 'Get profile picture of mentioned or quoted user',
  execute: async (sock, msg, args, extra) => {
    const { reply, react, from } = extra;

    const contextInfo = msg.message?.extendedTextMessage?.contextInfo
      || msg.message?.imageMessage?.contextInfo
      || msg.message?.videoMessage?.contextInfo
      || msg.message?.stickerMessage?.contextInfo
      || null;

    const quoted = contextInfo?.participant || contextInfo?.remoteJid || null;
    const mentioned = contextInfo?.mentionedJid?.[0] || null;

    const targetJid = quoted || mentioned || msg.key.participant || msg.key.remoteJid;

    if (!targetJid) {
      await react('❌');
      return reply('❌ Mention or quote a user to get their profile picture.');
    }

    await react('⏳');

    try {
      // Fetch group metadata for LID resolution (null if DM)
      let groupMetadata = null;
      if (from.endsWith('@g.us')) {
        try {
          groupMetadata = await sock.groupMetadata(from);
        } catch (_) {}
      }

      const { url: ppUrl, jid: resolvedJid } = await tryFetchProfilePictureUrl(
        sock,
        targetJid,
        groupMetadata
      );

      if (!ppUrl) {
        await react('❌');
        return reply('❌ Could not fetch profile picture. The user may have privacy settings enabled or has no picture set.');
      }

      const displayTag = displayUserTag(resolvedJid, groupMetadata);

      await sock.sendMessage(
        from,
        {
          image: { url: ppUrl },
          caption: `📸 @${displayTag}`,
          mentions: [resolvedJid],
        },
        { quoted: msg }
      );

      await react('✅');
    } catch (err) {
      await react('❌');
      await reply('❌ Could not fetch profile picture. The user may have privacy settings enabled or has no picture set.');
    }
  },
};
