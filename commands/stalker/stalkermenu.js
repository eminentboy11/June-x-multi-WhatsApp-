const config = require('../../config');
const getBotName = () => config.botName;

module.exports = {
  name: 'stalkermenu',
  aliases: ['smenu', 'stalkermenu', 'stalkercmds'],
  description: 'Shows all Stalker commands',
  category: 'Stalker Commands',

  async execute(sock, m, args, extra) {
    const jid = m.key.remoteJid;
    const botName = getBotName();

    const commandsText = `╭─⊷ *📢 WHATSAPP CHANNEL*
│
│  • wachannel <URL>
│
╰─⊷

╭─⊷ *🎵 TIKTOK*
│
│  • tiktokstalk <username>
│
╰─⊷

╭─⊷ *🐦 TWITTER/X*
│
│  • twitterstalk <username>
│
╰─⊷

╭─⊷ *🌐 IP ADDRESS*
│
│  • ipstalk <IP>
│
╰─⊷

╭─⊷ *📸 INSTAGRAM*
│
│  • igstalk <username>
│
╰─⊷

╭─⊷ *📦 NPM PACKAGE*
│
│  • npmstalk <package>
│
╰─⊷

╭─⊷ *🐙 GITHUB*
│
│  • gitstalk <username>
│
╰─⊷`;

    await sock.sendMessage(jid, { text: commandsText }, { quoted: m });
  }
};
