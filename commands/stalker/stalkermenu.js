const config = require('../../config');
const getBotName = () => config.botName;

module.exports = {
  name: 'stalkercmd',
  aliases: ['smenu', 'stalkermenu', 'stalkercmds'],
  description: 'Shows all Stalker commands',
  category: 'Stalker Commands',

  async execute(sock, m, args, extra) {
    const jid = m.key.remoteJid;
    const botName = getBotName();

    const commandsText =
      `┏━━『 🕵️ STALKER COMMANDS 』━━\n` +
      `➥ WhatsApp Channel ➜ wachannel <URL>\n` +
      `➥ TikTok           ➜ tiktokstalk <username>\n` +
      `➥ Twitter/X        ➜ twitterstalk <username>\n` +
      `➥ IP Address       ➜ ipstalk <IP>\n` +
      `➥ Instagram        ➜ igstalk <username>\n` +
      `➥ NPM Package      ➜ npmstalk <package>\n` +
      `➥ GitHub           ➜ gitstalk <username>\n` +
      `➥ Powered By       ➜ ${botName}\n` +
      `┗━━━━━━━━━━━━━━━━`;

    await sock.sendMessage(jid, { text: commandsText }, { quoted: m });
  }
};
