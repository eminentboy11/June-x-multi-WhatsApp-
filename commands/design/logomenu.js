const config = require('../../config');

module.exports = {
  name: 'logomenu',
  aliases: ['logos', 'logohelp', 'logocmds', 'designmenu'],
  category: 'design',
  description: 'Show available logo design commands',
  usage: '.logomenu',

  async execute(sock, msg) {
    const jid = msg.key.remoteJid;
    const prefix = config.prefix || '.';
    const botName = config.botName || 'JuneX-Ultra';
    const commandsText = `🌟 Premium metals

• ${prefix}goldlogo
• ${prefix}silverlogo
• ${prefix}platinumlogo
• ${prefix}chromelogo
• ${prefix}diamondlogo
• ${prefix}bronzelogo
• ${prefix}steellogo
• ${prefix}copperlogo
• ${prefix}titaniumlogo

🔥 Elemental effects

• ${prefix}firelogo
• ${prefix}icelogo
• ${prefix}iceglowlogo
• ${prefix}lightninglogo
• ${prefix}rainbowlogo
• ${prefix}sunlogo
• ${prefix}moonlogo

🎭 Mythical and magical

• ${prefix}dragonlogo
• ${prefix}phoenixlogo
• ${prefix}wizardlogo
• ${prefix}crystallogo
• ${prefix}darkmagiclogo

🌌 Dark and gothic

• ${prefix}shadowlogo
• ${prefix}smokelogo
• ${prefix}bloodlogo

💫 Glow and neon

• ${prefix}neonlogo
• ${prefix}glowlogo
• ${prefix}gradientlogo
• ${prefix}matrixlogo
• ${prefix}aqualogo

Powered by ${botName}
Use ${prefix}<command> followed by your text.`;

    await sock.sendMessage(jid, {
      text: `🎨 *LOGO DESIGN MENU*\n\n${commandsText}`,
    }, { quoted: msg });
  },
};