const config = require('../../config');
const APIs = require('../../utils/api');
const getFooter = () => `Powered by ${config.botName}`;

module.exports = {
  name: 'ipstalk',
  aliases: ['ipinfo2', 'iplookup', 'iptrack'],
  description: 'Look up information about an IP address',
  category: 'Stalker Commands',

  async execute(sock, m, args, extra) {
    const jid = m.key.remoteJid;
    const prefix = config.prefix || '.';

    if (!args || !args[0]) {
      return sock.sendMessage(jid, {
        text: `╭─⌈ 🔍 *IP STALKER* ⌋\n│\n├─⊷ *${prefix}ipstalk <IP address>*\n│  └⊷ Look up IP address info\n│\n├─⊷ *Example:*\n│  └⊷ ${prefix}ipstalk 41.90.70.195\n│\n╰⊷ ${getFooter(m.key.participant || m.key.remoteJid)}`
      }, { quoted: m });
    }

    const address = args[0].trim();
    await sock.sendMessage(jid, { react: { text: '🔍', key: m.key } });

    try {
      const d = await APIs.stalkIp(address);

      const caption = `╭─⌈ 🌐 *IP ADDRESS INFO* ⌋\n│\n├─⊷ *🔢 IP:* ${address}\n├─⊷ *🌍 Country:* ${d.country || 'N/A'}\n├─⊷ *🗺️ Continent:* ${d.continent || 'N/A'}\n├─⊷ *📌 Country Code:* ${d.countryCode || 'N/A'}\n├─⊷ *📡 ASN:* ${d.asn || 'N/A'}\n├─⊷ *🏢 ISP/AS Name:* ${d.asName || 'N/A'}\n├─⊷ *🌐 AS Domain:* ${d.asDomain || 'N/A'}${d.continentCode ? `\n├─⊷ *🗺️ Continent Code:* ${d.continentCode}` : ''}\n│\n╰───────────────\n> 🐺 *${config.botName} STALKER*`;

      await sock.sendMessage(jid, { text: caption }, { quoted: m });
      await sock.sendMessage(jid, { react: { text: '✅', key: m.key } });

    } catch (error) {
      console.error('❌ [IPSTALK] Error:', error.message);
      await sock.sendMessage(jid, { react: { text: '❌', key: m.key } });
      await sock.sendMessage(jid, {
        text: `❌ *IP Stalk Failed*\n\n⚠️ ${error.message}\n\n💡 Make sure the IP address is valid.`
      }, { quoted: m });
    }
  }
};
