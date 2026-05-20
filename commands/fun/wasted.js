const axios = require('axios');

module.exports = {
  name: 'wasted',
  aliases: ['waste', 'rip'],
  category: 'fun',
  description: 'Put a wasted effect on someone\'s profile picture',
  usage: '.wasted @user or reply to a message',

  async execute(sock, msg, args, extra) {
    const chatId = extra.from;

    // --- Resolve target user ---
    let userToWaste =
      msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] ||
      msg.message?.extendedTextMessage?.contextInfo?.participant ||
      null;

    if (!userToWaste) {
      return await sock.sendMessage(chatId, {
        text: '⚰️ Please mention someone or reply to their message to waste them!'
      }, { quoted: msg });
    }

    await sock.sendMessage(chatId, {
      react: { text: '💀', key: msg.key }
    });

    try {
      // --- Get profile picture ---
      let profilePic;
      try {
        profilePic = await sock.profilePictureUrl(userToWaste, 'image');
      } catch {
        profilePic = 'https://i.imgur.com/2wzGhpF.jpeg';
      }

      // --- Fetch wasted overlay ---
      const wastedResponse = await axios.get(
        `https://some-random-api.com/canvas/overlay/wasted?avatar=${encodeURIComponent(profilePic)}`,
        { responseType: 'arraybuffer', timeout: 15000 }
      );

      const username = userToWaste.split('@')[0];

      const caption =
        `⚰️ *Wasted:* @${username}\n` +
        `💀 _Rest in pieces!_`;

      // --- Send wasted image ---
      await sock.sendMessage(chatId, {
        image: Buffer.from(wastedResponse.data),
        caption: caption,
        mentions: [userToWaste]
      }, { quoted: msg });

    } catch (error) {
      console.error('[WASTED] Error:', error?.message || error);
      await sock.sendMessage(chatId, {
        text: '❌ Failed to create wasted image. Try again later.'
      }, { quoted: msg });
    }
  }
};
