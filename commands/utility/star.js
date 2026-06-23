const { applyFont } = require('../utils/fontConverter');

module.exports = {
  name: 'star',
  aliases: ['bookmark', 'unstar'],
  description: 'Star or unstar a quoted message',
  usage: '.star (reply to a message)',
  category: 'utility',

  async execute(sock, msg, args, extra) {
    const { reply, react, from } = extra;

    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage
      ? msg.message.extendedTextMessage.contextInfo
      : msg.message?.imageMessage?.contextInfo
      ?? msg.message?.videoMessage?.contextInfo
      ?? msg.message?.audioMessage?.contextInfo
      ?? msg.message?.documentMessage?.contextInfo
      ?? null;

    if (!quoted) {
      return reply(
        `${applyFont('⭐ Star Command', 'bold')}\n\n` +
        `Reply to any message with *.star* to star it.\n` +
        `Reply with *.unstar* to remove the star.`
      );
    }

    const stanzaId = quoted.stanzaId;
    const participant = quoted.participant || from;
    const isGroup = from.endsWith('@g.us');
    const remoteJid = from;

    // Determine action: .unstar alias → unstar, else star
    const commandUsed = msg.message?.extendedTextMessage?.text?.trim().split(' ')[0].replace(/^[./!]/, '').toLowerCase()
      ?? 'star';
    const shouldStar = commandUsed !== 'unstar';

    try {
      await react('⏳');

      await sock.chatModify(
        {
          star: {
            messages: [{ id: stanzaId, fromMe: participant === sock.user.id }],
            star: shouldStar,
          },
        },
        remoteJid
      );

      await react('✅');
      await reply(shouldStar ? '⭐ Message starred!' : '✩ Message unstarred.');

    } catch (err) {
      console.error('[star] Error:', err.message);
      await react('❌');
      return reply(`❌ Failed to ${shouldStar ? 'star' : 'unstar'} message.\n_${err.message}_`);
    }
  },
};
