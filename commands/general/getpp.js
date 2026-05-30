const axios = require('axios');
const { tryFetchProfilePictureUrl, displayUserTag, normalizeJidWithLid } = require('../../utils/jidHelper');

function toJid(input) {
  if (!input) return null;
  let s = String(input).trim();
  // Already a full JID — normalize it
  if (s.includes('@')) return normalizeJidWithLid(s);
  s = s.replace(/[^0-9]/g, '');
  if (!s) return null;
  return `${s}@s.whatsapp.net`;
}

function quotedSenderJid(ctx, chatJid) {
  // ctx.participant = quoted sender JID in groups (may be @lid)
  // ctx.remoteJid  = quoted sender JID in DMs, or group JID in groups
  if (ctx.participant) return normalizeJidWithLid(ctx.participant);
  // Only use remoteJid as the sender if this is a DM (not a group)
  if (ctx.remoteJid && !String(chatJid).endsWith('@g.us')) {
    return normalizeJidWithLid(ctx.remoteJid);
  }
  return null;
}

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
  description: 'Get profile picture of a user (works in DMs and groups, supports @lid)',
  usage: '.getpp <phone> | reply | tag | (no arg = your own)',

  async execute(sock, msg, args, extra) {
    try {
      let targetUser = null;
      const ctx = msg.message?.extendedTextMessage?.contextInfo
                || msg.message?.imageMessage?.contextInfo
                || msg.message?.videoMessage?.contextInfo
                || {};

      const chatJid = extra.from || msg.key.remoteJid;

      // 1) Mention / tag — normalize @lid if needed
      if (Array.isArray(ctx.mentionedJid) && ctx.mentionedJid.length) {
        targetUser = normalizeJidWithLid(ctx.mentionedJid[0]);
      }

      // 2) Phone number / JID argument
      if (!targetUser && args && args.length && args[0] && !args[0].startsWith('@')) {
        targetUser = toJid(args[0]);
      }

      // 3) Reply to a quoted message — properly extract sender JID
      if (!targetUser && ctx.quotedMessage) {
        targetUser = quotedSenderJid(ctx, chatJid);
      }

      // 4) Default — sender themselves
      if (!targetUser) {
        targetUser = normalizeJidWithLid(
          extra.sender || msg.key.participant || msg.key.remoteJid
        );
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
