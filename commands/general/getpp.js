const axios = require('axios');

function toJid(input) {
  if (!input) return null;
  let s = String(input).trim();
  if (s.includes('@')) return s;
  s = s.replace(/[^0-9]/g, '');
  if (!s) return null;
  return `${s}@s.whatsapp.net`;
}

module.exports = {
  name: 'getpp',
  aliases: ['gp', 'getpic', 'getdp'],
  category: 'general',
  description: 'Get profile picture of a user (works in DMs and groups)',
  usage: '.getpp <phone> | reply | tag | (no arg = your own)',

  async execute(sock, msg, args, extra) {
    try {
      let targetUser = null;
      const ctx = msg.message?.extendedTextMessage?.contextInfo
                || msg.message?.imageMessage?.contextInfo
                || msg.message?.videoMessage?.contextInfo
                || {};

      // 1) Phone number / JID argument: .getpp 254798570132
      if (args && args.length && args[0]) {
        targetUser = toJid(args[0]);
      }

      // 2) Reply to a message
      if (!targetUser && ctx.quotedMessage) {
        targetUser = ctx.participant
          || ctx.remoteJid
          || msg.message?.extendedTextMessage?.contextInfo?.participant;
      }

      // 3) Mention / tag
      if (!targetUser && Array.isArray(ctx.mentionedJid) && ctx.mentionedJid.length) {
        targetUser = ctx.mentionedJid[0];
      }

      // 4) Default — sender themselves (works in both DMs and groups)
      if (!targetUser) {
        targetUser = extra.sender
          || msg.key.participant
          || msg.key.remoteJid;
      }

      if (!targetUser) {
        return extra.reply('❌ Could not identify target user.\n\nUsage:\n• .getpp 254798570132\n• .getpp @user\n• Reply to a message with .getpp');
      }

      const from = extra.from || msg.key.remoteJid;

      let ppUrl;
      try {
        ppUrl = await sock.profilePictureUrl(targetUser, 'image');
      } catch (e) {
        const code = e?.output?.statusCode;
        const m = (e?.message || '').toLowerCase();
        if (code === 401 || m.includes('forbidden') || m.includes('unauthorized')) {
          return extra.reply(`❌ @${targetUser.split('@')[0]}'s profile picture is private.`);
        }
        if (code === 404 || code === 500 || m.includes('not found') || m.includes('item-not-found')) {
          return extra.reply(`❌ No profile picture set for @${targetUser.split('@')[0]}.`);
        }
        return extra.reply('❌ Could not fetch profile picture for this user.');
      }

      if (!ppUrl) {
        return extra.reply(`❌ No profile picture found for @${targetUser.split('@')[0]}.`);
      }

      const response = await axios.get(ppUrl, { responseType: 'arraybuffer', timeout: 30000 });
      const buffer = Buffer.from(response.data);

      await sock.sendMessage(from, {
        image: buffer,
        caption: `👤 Profile picture of @${targetUser.split('@')[0]}`,
        mentions: [targetUser],
      }, { quoted: msg });

    } catch (error) {
      try { await extra.reply('❌ Profile picture not found for this user.'); } catch (_) {}
    }
  },
};
