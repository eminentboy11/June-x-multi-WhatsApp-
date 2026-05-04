const axios = require('axios');
const { tryFetchProfilePictureUrl, displayUserTag } = require(require('path').join(global.__CORE__, 'utils', 'jidHelper'));

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
  description: 'Get profile picture of a user (works in DMs and groups, supports @lid)',
  usage: '.getpp <phone> | reply | tag | (no arg = your own)',

  async execute(sock, msg, args, extra) {
    try {
      let targetUser = null;
      const ctx = msg.message?.extendedTextMessage?.contextInfo
                || msg.message?.imageMessage?.contextInfo
                || msg.message?.videoMessage?.contextInfo
                || {};

      // 1) Mention / tag — checked FIRST so .getpp @user uses the real JID
      //    (not the literal @1234 text in args, which can be a wrong number for @lid users)
      if (Array.isArray(ctx.mentionedJid) && ctx.mentionedJid.length) {
        targetUser = ctx.mentionedJid[0];
      }

      // 2) Phone number / JID argument: .getpp 254798570132
      //    Only if it's a plain number (no '@' literal text from a tag)
      if (!targetUser && args && args.length && args[0] && !args[0].startsWith('@')) {
        targetUser = toJid(args[0]);
      }

      // 3) Reply to a message
      if (!targetUser && ctx.quotedMessage) {
        targetUser = ctx.participant
          || ctx.remoteJid
          || msg.message?.extendedTextMessage?.contextInfo?.participant;
      }

      // 4) Default — sender themselves (works in DMs and groups)
      if (!targetUser) {
        targetUser = extra.sender
          || msg.key.participant
          || msg.key.remoteJid;
      }

      if (!targetUser) {
        return extra.reply('❌ Could not identify target user.\n\nUsage:\n• .getpp 254798570132\n• .getpp @user\n• Reply to a message with .getpp');
      }

      const from = extra.from || msg.key.remoteJid;
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
        return extra.reply('❌ Could not fetch profile picture for this user.');
      }

      if (!result || !result.url) {
        return extra.reply(`❌ No profile picture found for @${tag}.`);
      }

      const response = await axios.get(result.url, { responseType: 'arraybuffer', timeout: 30000 });
      const buffer = Buffer.from(response.data);

      await sock.sendMessage(from, {
        image: buffer,
        caption: `👤 Profile picture of @${tag}`,
        mentions: [targetUser, result.jid].filter((v, i, a) => v && a.indexOf(v) === i),
      }, { quoted: msg });

    } catch (error) {
      try { await extra.reply('❌ Profile picture not found for this user.'); } catch (_) {}
    }
  },
};
