/**
 * AntiEdit Command
 * Catches message edits and reveals the original content.
 *
 * Modes:
 *   on / chat   → post the reveal in the same chat
 *   private     → send the reveal to the bot owner's DM
 *   off         → disabled
 *
 * Settings stored per-chat in data/antiedit.json
 * { "<chatJid>": { "mode": "off" | "chat" | "private" } }
 */

const fs   = require('fs');
const path = require('path');
const config = require('../../config');

const CONFIG_PATH = path.join(__dirname, '../../data/antiedit.json');

// ── Persist settings ────────────────────────────────────────────────────────

function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) fs.writeFileSync(CONFIG_PATH, '{}');
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch { return {}; }
}

function saveConfig(cfg) {
  try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2)); } catch {}
}

function getMode(chatId) {
  const cfg = loadConfig();
  return cfg[chatId]?.mode || 'off';
}

function setMode(chatId, mode) {
  const cfg = loadConfig();
  cfg[chatId] = { ...(cfg[chatId] || {}), mode };
  saveConfig(cfg);
}

// ── In-memory message store: Map<chatId, Map<msgId, entry>> ─────────────────
// entry = { sender, timestamp, text, pushName }

const messageStore = new Map();

/**
 * Called for every incoming message — stores text so we can compare on edit.
 */
function storeMessage(msg) {
  try {
    if (!msg?.key?.id || !msg.message) return;
    const chatId = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;
    const inner  = msg.message;

    const text =
      inner.conversation ||
      inner.extendedTextMessage?.text ||
      inner.ephemeralMessage?.message?.conversation ||
      inner.ephemeralMessage?.message?.extendedTextMessage?.text ||
      null;

    if (!text) return; // only track text messages (edits only apply to text)

    if (!messageStore.has(chatId)) messageStore.set(chatId, new Map());
    const chatMap = messageStore.get(chatId);
    chatMap.set(msg.key.id, {
      sender,
      timestamp:  msg.messageTimestamp,
      text,
      pushName:   msg.pushName || null,
    });

    // Keep last 300 per chat to limit memory
    if (chatMap.size > 300) chatMap.delete(chatMap.keys().next().value);
  } catch (_) {}
}

/**
 * Called from handler.js when messages.update fires.
 * Detects edits (update.message?.editedMessage) and reacts accordingly.
 */
async function handleAntiEdit(sock, updates) {
  for (const { key, update } of updates) {
    try {
      const newMsg =
        update?.message?.editedMessage?.message ||
        update?.message?.protocolMessage?.editedMessage ||
        null;

      if (!newMsg) continue;

      const chatId = key.remoteJid;
      const msgId  = key.id;
      const mode   = getMode(chatId);
      if (!mode || mode === 'off') continue;

      // Retrieve stored original
      const original = messageStore.get(chatId)?.get(msgId);
      const originalText = original?.text || '[Original not available]';
      const sender       = original?.sender || key.participant || key.remoteJid || 'Unknown';

      // Extract new (edited) text
      const editedText =
        newMsg.conversation ||
        newMsg.extendedTextMessage?.text ||
        '[Edited content not available]';

      // Skip if text didn't actually change (sometimes edits just update metadata)
      if (originalText !== '[Original not available]' && originalText === editedText) continue;

      const senderNum  = sender.split('@')[0].split(':')[0];
      const timestamp  = original?.timestamp
        ? new Date(original.timestamp * 1000).toLocaleString('en-GB', {
            hour12: false, timeZone: config.timezone || 'Africa/Nairobi',
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
          })
        : new Date().toLocaleString();

      // Build reveal text
      const readmore = String.fromCharCode(8206).repeat(4001);
      const replyText =
        `✏️ *EDITED MESSAGE DETECTED!*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 *Sender:* @${senderNum}\n` +
        `🕐 *Time:* ${timestamp}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n${readmore}\n` +
        `📝 *Original:*\n${originalText}\n\n` +
        `✏️ *Edited to:*\n${editedText}\n` +
        `━━━━━━━━━━━━━━━━━━━━`;

      // Determine target
      let targetJid;
      if (mode === 'private') {
        const botNum = sock.user?.id?.split(':')[0] + '@s.whatsapp.net';
        targetJid = botNum;
      } else {
        targetJid = chatId;
      }

      await sock.sendMessage(targetJid, {
        text: replyText,
        mentions: [sender],
      });

      // Update store with the new (edited) text
      if (messageStore.has(chatId) && messageStore.get(chatId).has(msgId)) {
        messageStore.get(chatId).get(msgId).text = editedText;
      }
    } catch (e) {
      console.error('[ANTIEDIT] error:', e.message);
    }
  }
}

// ── Command module ───────────────────────────────────────────────────────────

module.exports = {
  name: 'antiedit',
  aliases: ['antieditmsg', 'editdetect'],
  category: 'admin',
  description: 'Detect and reveal edited messages',
  usage: '.antiedit on | off | chat | private | status',
  adminOnly: true,

  storeMessage,
  handleAntiEdit,

  async execute(sock, msg, args, extra) {
    const { from, reply } = extra;
    const sub = (args[0] || '').toLowerCase();
    const currentMode = getMode(from);

    const modeLabel = () => {
      if (!currentMode || currentMode === 'off') return '❌ OFF';
      if (currentMode === 'chat')    return '✅ ON — Chat (revealed here)';
      if (currentMode === 'private') return '✅ ON — Private (sent to bot\'s own DM)';
      return currentMode;
    };

    if (!sub || sub === 'status') {
      return reply(
        `✏️ *Anti-Edit*\n` +
        `━━━━━━━━━━━━━━━\n` +
        `📌 Status: *${modeLabel()}*\n\n` +
        `Catches message edits and reveals the original content.\n\n` +
        `*Commands:*\n` +
        `  .antiedit on       — enable (reveal in this chat)\n` +
        `  .antiedit chat     — reveal edited msgs in this chat\n` +
        `  .antiedit private  — send alert to bot's own DM silently\n` +
        `  .antiedit off      — disable\n` +
        `  .antiedit status   — show current setting`
      );
    }

    if (sub === 'on' || sub === 'chat') {
      setMode(from, 'chat');
      return reply('✅ *Anti-Edit* enabled — edited messages will be revealed *in this chat*.');
    }

    if (sub === 'private') {
      setMode(from, 'private');
      return reply('✅ *Anti-Edit* enabled — edited messages sent *privately to owner\'s DM*.');
    }

    if (sub === 'off') {
      setMode(from, 'off');
      return reply('❌ *Anti-Edit* disabled.');
    }

    return reply('⚠️ Usage: .antiedit on | off | chat | private | status');
  }
};
