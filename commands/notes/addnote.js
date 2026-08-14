const config = require('../../config');
const db = require('../../database');

const NOTES_NAMESPACE = 'user_notes';
const MAX_NOTES_PER_USER = 100;
const MAX_NOTE_LENGTH = 1000;

function getUserId(m) {
  const jid = m.key.participant || m.key.remoteJid || '';
  return jid.split(':')[0].split('@')[0];
}

module.exports = {
  name: 'addnote',
  aliases: ['savenote', 'newnote'],
  description: 'Save a personal note',
  category: 'notes',

  async execute(sock, m, args, extra) {
    const jid = m.key.remoteJid;
    const prefix = config.prefix || '.';

    const text = (args || []).join(' ').trim();
    if (!text) {
      await sock.sendMessage(jid, {
        text:
          `┏━━『 📝 ADDNOTE 』━━\n` +
          `➥ Usage      ➜ ${prefix}addnote <your note>\n` +
          `➥ Example    ➜ ${prefix}addnote I will come tomorrow\n` +
          `➥ View       ➜ ${prefix}mynotes\n` +
          `➥ Powered By ➜ ${config.botName}\n` +
          `┗━━━━━━━━━━━━━━━━`
      }, { quoted: m });
      return;
    }

    if (text.length > MAX_NOTE_LENGTH) {
      await sock.sendMessage(jid, {
        text: `❌ Note too long (max ${MAX_NOTE_LENGTH} characters).`
      }, { quoted: m });
      return;
    }

    try {
      const userId = getUserId(m);
      const notes = db.getKV(NOTES_NAMESPACE, userId, []);

      if (notes.length >= MAX_NOTES_PER_USER) {
        await sock.sendMessage(jid, {
          text: `❌ You already have ${MAX_NOTES_PER_USER} notes. Delete some via *${prefix}mynotes* before adding more.`
        }, { quoted: m });
        return;
      }

      const note = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        text,
        savedAt: Date.now()
      };
      notes.push(note);

      db.setKV(NOTES_NAMESPACE, userId, notes);

      await sock.sendMessage(jid, { react: { text: '📝', key: m.key } });
      await sock.sendMessage(jid, {
        text:
          `┏━━『 ✅ NOTE SAVED 』━━\n` +
          `➥ Note #     ➜ ${notes.length}\n` +
          `➥ Text       ➜ ${text}\n` +
          `➥ Total Notes ➜ ${notes.length}\n` +
          `➥ View All   ➜ ${prefix}mynotes\n` +
          `➥ Powered By ➜ ${config.botName}\n` +
          `┗━━━━━━━━━━━━━━━━`
      }, { quoted: m });
    } catch (err) {
      console.error('❌ [ADDNOTE] Error:', err.message);
      await sock.sendMessage(jid, { text: `❌ Failed to save note: ${err.message}` }, { quoted: m });
    }
  }
};
