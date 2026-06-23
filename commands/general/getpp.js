// commands/getpp.js
module.exports = {
  name: 'getpp',
  aliases: ['profilepic', 'pp', 'pfp'],
  category: 'general',
  description: 'Get profile picture of mentioned or quoted user',
  execute: async (sock, msg, args, extra) => {
    const { reply, react, from } = extra;

    let targetJid = null;

    const contextInfo = msg.message?.extendedTextMessage?.contextInfo
      || msg.message?.imageMessage?.contextInfo
      || msg.message?.videoMessage?.contextInfo
      || msg.message?.stickerMessage?.contextInfo
      || null;

    const quoted = contextInfo?.participant || contextInfo?.remoteJid || null;
    const mentioned = contextInfo?.mentionedJid?.[0] || null;

    targetJid = quoted || mentioned || msg.key.participant || msg.key.remoteJid;

    if (!targetJid) {
      await react('❌');
      return reply('❌ Mention or quote a user to get their profile picture.');
    }

    await react('⏳');

    try {
      const ppUrl = await sock.profilePictureUrl(targetJid, 'image');

      await sock.sendMessage(
        from,
        {
          image: { url: ppUrl },
          caption: `📸 @${targetJid.split('@')[0]}`,
          mentions: [targetJid],
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
