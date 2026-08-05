const config = require('../../config');

module.exports = {
  name: 'videomenu',
  aliases: ['vidmenu', 'aividmenu', 'videoeffects'],
  description: 'Show AI video effect commands',
  category: 'aivideo',
  usage: `${config.prefix || '.'}videomenu`,

  async execute(sock, msg, args, extra = {}) {
    const jid = msg.key.remoteJid;
    const prefix = extra.prefix || config.prefix || '.';
    const commandsText = [
      '🎬 AI video commands',
      '',
      `${prefix}tigervideo`,
      `${prefix}introvideo`,
      `${prefix}lightningpubg`,
      `${prefix}lovevideo`,
      `${prefix}videogen`,
    ].join('\n');

    return sock.sendMessage(jid, { text: commandsText }, { quoted: msg });
  },
};