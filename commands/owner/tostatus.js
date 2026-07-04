// commands/statusbroadcast.js
const { downloadMediaMessage } = require('@whiskeysockets/baileys');

module.exports = {
  name: 'statusbroadcast',
  aliases: ['statusupdate', 'poststatus'],
  category: 'owner',
  description: 'Post an image, video, audio, or text as a WhatsApp status update',
  execute: async (sock, msg, args, extra) => {
    const { reply, react } = extra;

    const contextInfo = msg.message?.extendedTextMessage?.contextInfo || null;
    const quotedMessage = contextInfo?.quotedMessage || null;
    const caption = args.join(' ') || '';
    const backgroundColor = '#000000';
    const font = 0;

    // Build contact list to notify (required or status shows to nobody)
    let statusJidList = [];
    if (sock.store?.contacts) {
      statusJidList = Object.keys(sock.store.contacts).filter((jid) =>
        jid.endsWith('@s.whatsapp.net')
      );
    } else if (sock.contacts) {
      statusJidList = Object.keys(sock.contacts).filter((jid) =>
        jid.endsWith('@s.whatsapp.net')
      );
    }

    if (statusJidList.length === 0) {
      await react('❌');
      return reply('❌ No contacts found to broadcast to. No contact store available.');
    }

    const hasMedia =
      quotedMessage?.imageMessage || quotedMessage?.videoMessage || quotedMessage?.audioMessage;

    if (!hasMedia && !caption) {
      await react('❌');
      return reply('❌ Quote an image/video/audio, or provide text, to post as status.');
    }

    await react('⏳');

    try {
      let content;

      if (hasMedia) {
        // downloadMediaMessage needs a full message-shaped object, including key
        const fakeMsg = {
          key: {
            remoteJid: contextInfo.remoteJid || msg.key.remoteJid,
            id: contextInfo.stanzaId,
            participant: contextInfo.participant,
          },
          message: quotedMessage,
        };

        const buffer = await downloadMediaMessage(fakeMsg, 'buffer', {});

        if (quotedMessage.imageMessage) {
          content = { image: buffer, caption };
        } else if (quotedMessage.videoMessage) {
          content = { video: buffer, caption };
        } else {
          content = {
            audio: buffer,
            mimetype: quotedMessage.audioMessage.mimetype || 'audio/mp4',
            ptt: quotedMessage.audioMessage.ptt || false,
          };
        }
      } else {
        content = { text: caption };
      }

      await sock.sendMessage('status@broadcast', content, {
        backgroundColor,
        font,
        statusJidList,
        broadcast: true,
      });

      await react('✅');
      await reply(`✅ Status posted to ${statusJidList.length} contacts.`);
    } catch (err) {
      await react('❌');
      await reply('❌ Failed to post status.');
    }
  },
};
