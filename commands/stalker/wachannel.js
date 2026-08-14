const axios = require('axios');
const config = require('../../config');
const APIs = require('../../utils/api');
const getFooter = () => `Powered by ${config.botName}`;

module.exports = {
  name: 'wachannel',
  aliases: ['channelstalk', 'wachannelstalk', 'wacs'],
  description: 'Stalk a WhatsApp Channel',
  category: 'Stalker Commands',

  async execute(sock, m, args, extra) {
    const jid = m.key.remoteJid;
    const prefix = config.prefix || '.';

    if (!args || !args[0]) {
      return sock.sendMessage(jid, {
        text:
          `┏━━『 🔍 WHATSAPP CHANNEL STALKER 』━━\n` +
          `➥ Command    ➜ ${prefix}wachannel <channel URL>\n` +
          `➥ Usage      ➜ Stalk a WhatsApp channel\n` +
          `➥ Example    ➜ ${prefix}wachannel https://whatsapp.com/channel/...\n` +
          `➥ Powered By ➜ ${config.botName}\n` +
          `┗━━━━━━━━━━━━━━━━`
      }, { quoted: m });
    }

    const url = args.join(' ').trim();
    await sock.sendMessage(jid, { react: { text: '🔍', key: m.key } });

    try {
      const { followers, img, description } = await APIs.stalkWachannel(url);

      let profileBuffer = null;
      if (img) {
        try {
          const imgRes = await axios.get(img, { responseType: 'arraybuffer', timeout: 10000 });
          if (imgRes.data.length > 500) profileBuffer = Buffer.from(imgRes.data);
        } catch {}
      }

      const caption =
        `┏━━『 📢 WHATSAPP CHANNEL INFO 』━━\n` +
        `➥ Followers  ➜ ${followers || 'N/A'}\n` +
        `➥ Description ➜ ${description || 'N/A'}\n` +
        `➥ URL        ➜ ${url}\n` +
        `➥ Powered By ➜ ${config.botName}\n` +
        `┗━━━━━━━━━━━━━━━━`;

      if (profileBuffer) {
        await sock.sendMessage(jid, { image: profileBuffer, caption }, { quoted: m });
      } else {
        await sock.sendMessage(jid, { text: caption }, { quoted: m });
      }

      await sock.sendMessage(jid, { react: { text: '✅', key: m.key } });

    } catch (error) {
      console.error('❌ [WACHANNEL] Error:', error.message);
      await sock.sendMessage(jid, { react: { text: '❌', key: m.key } });
      await sock.sendMessage(jid, {
        text: `❌ *Channel Stalk Failed*\n\n⚠️ ${error.message}\n\n💡 Make sure you provide a valid WhatsApp channel URL.`
      }, { quoted: m });
    }
  }
};
