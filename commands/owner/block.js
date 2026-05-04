/**
 * Block Command — block one or more users
 * Accepts: .block @user, .block 254xxxxxxxxx, reply to a user, or any combo.
 * Always normalises to "<digits>@s.whatsapp.net" before calling
 *   sock.updateBlockStatus(jid, 'block')
 */

const { normalizeJidWithLid } = require(require('path').join(global.__CORE__, 'utils', 'jidHelper'));

function phoneToJid(raw) {
  const digits = String(raw).replace(/[\s\-().+,]/g, '').replace(/^0+/, '');
  if (!digits || digits.length < 7) return null;
  return `${digits}@s.whatsapp.net`;
}

function looksLikePhone(token) {
  return /^[+\d][\d\s\-().]{5,}[,]?$/.test(token);
}

// Force any JID to "<digits>@s.whatsapp.net" — resolves @lid via mapping when known
function toWhatsappNetJid(jid) {
  if (!jid) return null;
  const norm = normalizeJidWithLid(jid) || jid;
  const user = String(norm).split('@')[0].split(':')[0];
  if (!user) return null;
  return `${user}@s.whatsapp.net`;
}

module.exports = {
  name: 'block',
  aliases: ['blockuser'],
  category: 'owner',
  description: 'Block one or more users (mention, reply, or phone number)',
  usage: '.block @user | .block 254140480956 | reply to a user with .block',
  ownerOnly: true,

  async execute(sock, msg, args, extra) {
    try {
      const ctx = msg.message?.extendedTextMessage?.contextInfo;
      const targets = new Set();

      // Mentions
      for (const m of (ctx?.mentionedJid || [])) {
        const jid = toWhatsappNetJid(m);
        if (jid) targets.add(jid);
      }

      // Reply
      if (ctx?.participant && ctx.stanzaId && ctx.quotedMessage) {
        const jid = toWhatsappNetJid(ctx.participant);
        if (jid) targets.add(jid);
      }

      // Phone-number args
      for (const tok of args) {
        const clean = tok.replace(/,+$/, '').trim();
        if (looksLikePhone(clean)) {
          const jid = phoneToJid(clean);
          if (jid) targets.add(jid);
        }
      }

      if (targets.size === 0) {
        return extra.reply(
          '❌ Please mention a user, reply to a user, or provide a phone number.\n\n' +
          'Examples:\n' +
          '• `.block @user`\n' +
          '• `.block 254140480956`\n' +
          '• Reply to a user with `.block`'
        );
      }

      const ok = [];
      const fail = [];

      for (const jid of targets) {
        try {
          await sock.updateBlockStatus(jid, 'block');
          ok.push(jid);
        } catch (e) {
          fail.push({ jid, err: e.message });
        }
      }

      let text = '';
      if (ok.length) {
        text += `✅ *Blocked (${ok.length}):*\n` +
                ok.map(j => `• @${j.split('@')[0]}`).join('\n');
      }
      if (fail.length) {
        if (text) text += '\n\n';
        text += `❌ *Failed (${fail.length}):*\n` +
                fail.map(f => `• @${f.jid.split('@')[0]} — ${f.err}`).join('\n');
      }

      await sock.sendMessage(extra.from, {
        text,
        mentions: [...ok, ...fail.map(f => f.jid)],
      }, { quoted: msg });

    } catch (error) {
      console.error('[block] error:', error);
      await extra.reply(`❌ Error: ${error.message}`);
    }
  },
};
