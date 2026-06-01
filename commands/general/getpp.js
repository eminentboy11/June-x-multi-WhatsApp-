const axios = require('axios');
const { tryFetchProfilePictureUrl, displayUserTag, normalizeJidWithLid } = require('../../utils/jidHelper');

async function downloadBuffer(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 30000,
        headers: { 'User-Agent': 'WhatsApp/2.24.6.77 A' }
      });
      return Buffer.from(response.data);
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

module.exports = {
  name: 'getpp',
  aliases: ['gp', 'getpic', 'getdp'],
  category: 'general',
  description: 'Get profile picture of the quoted/replied-to user',
  usage: '.getpp — reply to a message to get that person\'s profile picture',

  async execute(sock, msg, args, extra) {
    try {
      const ctx = msg.message?.extendedTextMessage?.contextInfo
                || msg.message?.imageMessage?.contextInfo
                || msg.message?.videoMessage?.contextInfo
                || msg.message?.stickerMessage?.contextInfo
                || {};

      if (!ctx.quotedMessage) {
        return extra.reply('❌ Please *reply* to a message to get that person\'s profile picture.');
      }

      const chatJid = extra.from || msg.key.remoteJid;
      const isGroup = String(chatJid).endsWith('@g.us');

      // Extract quoted sender JID
      let targetUser = null;
      if (ctx.participant) {
        targetUser = normalizeJidWithLid(ctx.participant);
      } else if (ctx.remoteJid && !isGroup) {
        targetUser = normalizeJidWithLid(ctx.remoteJid);
      }

      if (!targetUser) {
        return extra.reply('❌ Could not identify the quoted user.');
      }

      const groupMeta = extra.groupMetadata || null;
      const tag = displayUserTag(targetUser, groupMeta);

      let result;
      try {
        result = await tryFetchProfilePictureUrl(sock, targetUser, groupMeta);
      } catch (e) {
        const code = e?.output?.statusCode;
        const m = (e?.message || '').toLowerCase();
        if (code === 401 || m.includes('forbidden') || m.includes('unauthorized')) {
          return extra.reply(`❌ @${tag}'s profile picture is private.`);
        }
        if (code === 404 || code === 500 || m.includes('not found') || m.includes('item-not-found')) {
          return extra.reply(`❌ No profile picture set for @${tag}.`);
        }
        return extra.reply(`❌ Could not fetch profile picture for @${tag}.`);
      }

      if (!result || !result.url) {
        return extra.reply(`❌ No profile picture found for @${tag}.`);
      }

      let buffer;
      try {
        buffer = await downloadBuffer(result.url);
      } catch (dlErr) {
        return extra.reply(`❌ Failed to download profile picture for @${tag}. Try again later.`);
      }

      await sock.sendMessage(chatJid, {
        image: buffer,
        caption: `👤 *Profile picture of @${tag}*`,
        mentions: [targetUser, result.jid].filter((v, i, a) => v && a.indexOf(v) === i),
      }, { quoted: msg });

    } catch (error) {
      try { await extra.reply('❌ Profile picture not found for this user.'); } catch (_) {}
    }
  },
};
