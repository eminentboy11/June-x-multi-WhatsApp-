       const config = require('../../config');
const db = require('../../database');

const NOTES_NAMESPACE = 'user_notes';

function getUserId(m) {
  const jid = m.key.participant || m.key.remoteJid || '';
  return jid.split(':')[0].split('@')[0];
}

functio       n fmtDate(ts) {
  try {
    return new Date(ts).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return '';
  }const
}

module.exports = {
  name: 'mynotes',
  aliases: ['notes', 'listnotes', 'shownotes'],
  description: 'View your saved notes',
  category: 'notes',

  async execute(sock, m, args, extra) {
    const jid = m.key.remoteJid;
    const prefix = config.prefix || '.';

    try {
      const userId = getUserId(m);
      const notes = db.getKV(NOTES_NAMESPACE, userId, []);

      const sub = (args[0] || '').toLowerCase();

      // ── Delete one ─────────────────────────────────────────────
      if (sub === 'del' || sub === 'delete' || sub === 'rm') {
        const idx = parseInt(args[1], 10);

        if (!idx || idx < 1 || idx > notes.length) {
          await sock.sendMessage(jid, {
            text:
              `❌ Invalid number.\n` +
              `*Usage:* ${prefix}mynotes del <number>`
          }, { quoted: m });

          return;
        }

        const removed = notes.splice(idx - 1, 1)[0];

        db.setKV(NOTES_NAMESPACE, userId, notes);

        await sock.sendMessage(jid, {
          react: {
            text: '🗑️',
            key: m.key
          }
        });

        await sock.sendMessage(jid, {
          text:
            `┏━━『  NOTE DELETED 』━━\n` +
            `➥ Note        ➜ ${removed.text}\n` +
            `➥ Remaining   ➜ ${notes.length}\n` +
            `┗━━━━━━━━━━━━━━━━`
        }, { quoted: m });

        return;
      }

      // ── Clear all ──────────────────────────────────────────────
      if (sub === 'clear' || sub === 'clearall' || sub === 'wipe') {
        if (!notes.length) {
          await sock.sendMessage(jid, {
            text: '📝 You have no notes to clear.'
          }, { quoted: m });

          return;
        }

        const removedCount = notes.length;

        db.setKV(NOTES_NAMESPACE, userId, []);

        await sock.sendMessage(jid, {
          react: {
            text: '🧹',
            key: m.key
          }
        });

        await sock.sendMessage(jid, {
          text:
            `┏━━『 🧹 NOTES CLEARED 』━━\n` +
            `➥ Removed     ➜ ${removedCount} notes\n` +
            `┗━━━━━━━━━━━━━━━━`
        }, { quoted: m });

        return;
      }

      // ── List notes ─────────────────────────────────────────────
      if (!notes.length) {
        await sock.sendMessage(jid, {
          text:
            `┏━━『 📝 MY NOTES 』━━\n` +
            `➥ You have no saved notes.\n` +
            `➥ Add one     ➜ ${prefix}addnote <text>\n` +
            `┗━━━━━━━━━━━━━━━━`
        }, { quoted: m });

        return;
      } 
  const lines = notes.map((n, i) =>
  `➥ *${i + 1}.* ${n.text}`
).join('\n');

const out =
  `┏━━『 📝 MY NOTES 』━━\n` +
  `➥ Total     ➜ ${notes.length}\n` +
  `${lines}\n` +
  `➥ Add       ➜ ${prefix}addnote <text>\n` +
  `➥ Delete    ➜ ${prefix}mynotes del <num>\n` +
  `➥ Clear     ➜ ${prefix}mynotes clear\n` +
  `┗━━━━━━━━━━━━━━━━`;

      await sock.sendMessage(jid, {
        text: out
      }, { quoted: m });

    } catch (err) {
      console.error('❌ [MYNOTES] Error:', err.message);

      await sock.sendMessage(jid, {
        text: `❌ Failed to load notes: ${err.message}`
      }, { quoted: m });
    }
  }
};