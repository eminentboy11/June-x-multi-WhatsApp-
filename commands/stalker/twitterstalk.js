const axios = require('axios');
const config = require('../../config');
const APIs = require('../../utils/api');
const getFooter = () => `Powered by ${config.botName}`;

module.exports = {
  name: 'twitterstalk',
  aliases: ['twstalk', 'xstalk', 'twitterinfo'],
  description: 'Stalk a Twitter/X user profile',
  category: 'Stalker Commands',

  async execute(sock, m, args, extra) {
    const jid = m.key.remoteJid;
    const prefix = config.prefix || '.';

    if (!args || !args[0]) {
      return sock.sendMessage(jid, {
        text:
          `┏━━『 🔍 TWITTER/X STALKER 』━━\n` +
          `➥ Command    ➜ ${prefix}twitterstalk <username>\n` +
          `➥ Usage      ➜ Stalk a Twitter/X profile\n` +
          `➥ Example    ➜ ${prefix}twitterstalk giftedmauriceke\n` +
          `➥ Powered By ➜ ${config.botName}\n` +
          `┗━━━━━━━━━━━━━━━━`
      }, { quoted: m });
    }

    const username = args[0].replace('@', '').trim();
    await sock.sendMessage(jid, { react: { text: '🔍', key: m.key } });

    try {
      const d = await APIs.stalkTwitter(username);

      let avatarBuffer = null;
      const avatarUrl = d.avatar || d.profile_image_url || d.profile_image_url_https;
      if (avatarUrl) {
        try {
          const imgRes = await axios.get(avatarUrl.replace('_normal', '_400x400'), {
            responseType: 'arraybuffer',
            timeout: 10000
          });
          if (imgRes.data.length > 500) avatarBuffer = Buffer.from(imgRes.data);
        } catch {}
      }

      let caption =
        `┏━━『 🐦 TWITTER/X PROFILE 』━━\n` +
        `➥ Name       ➜ ${d.name || 'N/A'}\n` +
        `➥ Username   ➜ @${d.username || d.screen_name || username}\n` +
        `➥ Bio        ➜ ${d.bio || d.description || 'N/A'}\n` +
        `➥ Followers  ➜ ${(d.followers || d.followers_count || 0).toLocaleString()}\n` +
        `➥ Following  ➜ ${(d.following || d.friends_count || 0).toLocaleString()}\n` +
        `➥ Tweets     ➜ ${(d.tweets || d.statuses_count || 0).toLocaleString()}\n` +
        `➥ Verified   ➜ ${d.verified ? 'Yes' : 'No'}`;
      if (d.location) caption += `\n➥ Location   ➜ ${d.location}`;
      if (d.website || d.url) caption += `\n➥ Website    ➜ ${d.website || d.url}`;
      caption += `\n➥ Powered By ➜ ${config.botName}\n┗━━━━━━━━━━━━━━━━`;

      if (avatarBuffer) {
        await sock.sendMessage(jid, { image: avatarBuffer, caption }, { quoted: m });
      } else {
        await sock.sendMessage(jid, { text: caption }, { quoted: m });
      }

      await sock.sendMessage(jid, { react: { text: '✅', key: m.key } });

    } catch (error) {
      console.error('❌ [TWITTERSTALK] Error:', error.message);
      await sock.sendMessage(jid, { react: { text: '❌', key: m.key } });
      await sock.sendMessage(jid, {
        text: `❌ *Twitter Stalk Failed*\n\n⚠️ ${error.message}\n\n💡 Check the username and try again.`
      }, { quoted: m });
    }
  }
};
