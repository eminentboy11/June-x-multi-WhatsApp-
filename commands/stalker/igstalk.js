const axios = require('axios');
const config = require('../../config');
const APIs = require('../../utils/api');
const getFooter = () => `Powered by ${config.botName}`;

module.exports = {
  name: 'igstalk',
  aliases: ['instastalk', 'iginfo', 'instagramstalk'],
  description: 'Stalk an Instagram user profile',
  category: 'Stalker Commands',

  async execute(sock, m, args, extra) {
    const jid = m.key.remoteJid;
    const prefix = config.prefix || '.';

    if (!args || !args[0]) {
      return sock.sendMessage(jid, {
        text: `╭─⌈ 🔍 *INSTAGRAM STALKER* ⌋\n│\n├─⊷ *${prefix}igstalk <username>*\n│  └⊷ Stalk an Instagram profile\n│\n├─⊷ *Example:*\n│  └⊷ ${prefix}igstalk giftedtechnexus\n│\n╰⊷ ${getFooter(m.key.participant || m.key.remoteJid)}`
      }, { quoted: m });
    }

    const username = args[0].replace('@', '').trim();
    await sock.sendMessage(jid, { react: { text: '🔍', key: m.key } });

    try {
      const d = await APIs.stalkInstagram(username);

      let avatarBuffer = null;
      if (d.avatar) {
        try {
          const imgRes = await axios.get(d.avatar, { responseType: 'arraybuffer', timeout: 10000 });
          if (imgRes.data.length > 500) avatarBuffer = Buffer.from(imgRes.data);
        } catch {}
      }

      const caption = `╭─⌈ 📸 *INSTAGRAM PROFILE* ⌋\n│\n├─⊷ *👤 Full Name:* ${d.full_name || 'N/A'}\n├─⊷ *🏷️ Username:* @${d.username || username}\n├─⊷ *📝 Bio:* ${d.description || 'N/A'}\n├─⊷ *📸 Posts:* ${d.posts || '0'}\n├─⊷ *👥 Followers:* ${d.followers || '0'}\n├─⊷ *👤 Following:* ${d.following || '0'}\n├─⊷ *🔒 Private:* ${d.is_private ? 'Yes' : 'No'}\n│\n╰───────────────\n> 🐺 *${config.botName} STALKER*`;

      if (avatarBuffer) {
        await sock.sendMessage(jid, { image: avatarBuffer, caption }, { quoted: m });
      } else {
        await sock.sendMessage(jid, { text: caption }, { quoted: m });
      }

      await sock.sendMessage(jid, { react: { text: '✅', key: m.key } });

    } catch (error) {
      console.error('❌ [IGSTALK] Error:', error.message);
      await sock.sendMessage(jid, { react: { text: '❌', key: m.key } });
      await sock.sendMessage(jid, {
        text: `❌ *Instagram Stalk Failed*\n\n⚠️ ${error.message}\n\n💡 Check the username and try again.`
      }, { quoted: m });
    }
  }
};
