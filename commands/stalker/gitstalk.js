const axios = require('axios');
const config = require('../../config');
const APIs = require('../../utils/api');

const DEFAULT_USER = 'torvalds';
const getFooter = () => `Powered by ${config.botName}`;

module.exports = {
  name: 'gitstalk',
  aliases: ['githubstalk', 'ghstalk'],
  description: 'Stalk a GitHub user profile',
  category: 'Stalker Commands',

  async execute(sock, m, args, extra) {
    const jid = m.key.remoteJid;
    const prefix = config.prefix || '.';

    if (!args || !args[0]) {
      return sock.sendMessage(jid, {
        text:
          `┏━━『 🔍 GITHUB STALKER 』━━\n` +
          `➥ Command    ➜ ${prefix}gitstalk <username>\n` +
          `➥ Usage      ➜ Stalk a GitHub profile\n` +
          `➥ Example    ➜ ${prefix}gitstalk ${DEFAULT_USER}\n` +
          `➥ Powered By ➜ ${config.botName}\n` +
          `┗━━━━━━━━━━━━━━━━`
      }, { quoted: m });
    }

    const username = args[0].replace('@', '').trim();
    await sock.sendMessage(jid, { react: { text: '🔍', key: m.key } });

    try {
      const raw = await APIs.stalkGitHub(username);
      const d = raw?.result || raw?.data || raw;

      if (!d || (!d.login && !d.username)) {
        throw new Error('User not found on GitHub');
      }

      const json = JSON.stringify(raw, null, 2);
      const jsonTruncated = json.length > 900 ? json.slice(0, 900) + '\n... (truncated)' : json;
      const jsonCaption = `\`\`\`json\n${jsonTruncated}\n\`\`\``;

      let avatarBuffer = null;
      const avatarUrl = d.avatar_url || d.avatar;
      if (avatarUrl) {
        try {
          const imgRes = await axios.get(avatarUrl, { responseType: 'arraybuffer', timeout: 10000 });
          if (imgRes.data.length > 500) avatarBuffer = Buffer.from(imgRes.data);
        } catch {}
      }

      if (avatarBuffer) {
        await sock.sendMessage(jid, { image: avatarBuffer, caption: jsonCaption }, { quoted: m });
      } else {
        await sock.sendMessage(jid, { text: jsonCaption }, { quoted: m });
      }

      await sock.sendMessage(jid, { react: { text: '✅', key: m.key } });

    } catch (error) {
      console.error('❌ [GITSTALK] Error:', error.message);
      await sock.sendMessage(jid, { react: { text: '❌', key: m.key } });
      await sock.sendMessage(jid, {
        text: `❌ *GitHub Stalk Failed*\n\n⚠️ ${error.message}\n\n💡 Check the username and try again.`
      }, { quoted: m });
    }
  }
};
