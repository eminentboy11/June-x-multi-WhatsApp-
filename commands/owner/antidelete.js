'use strict';

/**
 * AntiDelete — recovers deleted messages (text, image, video, audio, sticker).
 *
 * Configuration is bot-wide SQLite state. Captured messages use one record path:
 *   in-memory cache for immediate recovery
 *   → SQLite antidelete_messages for recovery after a restart
 *
 * There is no file-backed backup, standalone anti-delete JSON, or second
 * persistent message store.
 */

const database = require('../../database');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

const messageStore = new Map();
const pendingPersistence = new Map();
const PERSIST_DEBOUNCE_MS = 2_000;
const PERSIST_RETRY_INTERVAL_MS = 5_000;

let persistenceTimer = null;
let lastPersistenceErrorAt = 0;

const getMode = () => database.getAntideleteMode();
const getTimezone = () => database.getBotSetting('timezone') || 'Africa/Nairobi';

const MEDIA_MAP = {
  imageMessage: 'image',
  videoMessage: 'video',
  audioMessage: 'audio',
  stickerMessage: 'sticker',
  documentMessage: 'document',
};

function unwrap(raw) {
  return (
    raw.ephemeralMessage?.message ||
    raw.viewOnceMessageV2Extension?.message ||
    raw.viewOnceMessageV2?.message ||
    raw.viewOnceMessage?.message ||
    raw
  );
}

function recordKey(chatId, messageId) {
  return `${String(chatId)}\u0000${String(messageId)}`;
}

function normaliseTimestamp(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

// Baileys media metadata includes Buffers such as mediaKey/file hashes. Encode
// those explicitly so a SQLite JSON payload can be restored into valid Buffers
// after a restart without writing a companion media/JSON file.
function encodeForDatabase(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return { __juneBigInt: value.toString() };
  if (Buffer.isBuffer(value)) return { __juneBuffer: value.toString('base64') };
  if (value instanceof Uint8Array) return { __juneBuffer: Buffer.from(value).toString('base64') };

  if (Array.isArray(value)) return value.map(item => encodeForDatabase(item, seen));
  if (typeof value !== 'object') return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);

  const output = {};
  for (const [key, item] of Object.entries(value)) {
    const encoded = encodeForDatabase(item, seen);
    if (encoded !== undefined) output[key] = encoded;
  }
  seen.delete(value);
  return output;
}

function decodeFromDatabase(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(decodeFromDatabase);
  if (typeof value !== 'object') return value;
  if (typeof value.__juneBuffer === 'string') {
    try { return Buffer.from(value.__juneBuffer, 'base64'); } catch (_) { return null; }
  }
  if (typeof value.__juneBigInt === 'string') return value.__juneBigInt;

  const output = {};
  for (const [key, item] of Object.entries(value)) output[key] = decodeFromDatabase(item);
  return output;
}

function toPersistentEntry(entry) {
  return {
    sender: String(entry.sender || ''),
    timestamp: normaliseTimestamp(entry.timestamp),
    type: String(entry.type || 'text'),
    mtype: entry.mtype ? String(entry.mtype) : null,
    text: entry.text === null || entry.text === undefined ? null : String(entry.text),
    inner: entry.mtype ? encodeForDatabase(entry.inner) : null,
  };
}

function fromPersistentEntry(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const type = String(payload.type || 'text');
  const mtype = payload.mtype ? String(payload.mtype) : null;
  const inner = payload.inner ? decodeFromDatabase(payload.inner) : null;
  if (type !== 'text' && (!mtype || !inner)) return null;

  return {
    sender: String(payload.sender || ''),
    timestamp: normaliseTimestamp(payload.timestamp),
    type,
    mtype,
    inner,
    text: payload.text === null || payload.text === undefined ? null : String(payload.text),
  };
}

function reportPersistenceError(error) {
  const now = Date.now();
  if (now - lastPersistenceErrorAt < 60_000) return;
  lastPersistenceErrorAt = now;
  console.error('[ANTIDELETE] SQLite persistence error:', error?.message || error);
}

function schedulePersistence() {
  if (persistenceTimer) return;
  persistenceTimer = setTimeout(() => {
    persistenceTimer = null;
    flushPersistentMessages();
  }, PERSIST_DEBOUNCE_MS);
  persistenceTimer.unref?.();
}

function queuePersistentMessage(chatId, messageId, entry) {
  pendingPersistence.set(recordKey(chatId, messageId), {
    chatId: String(chatId),
    messageId: String(messageId),
    payload: toPersistentEntry(entry),
    storedAt: Date.now(),
  });
  schedulePersistence();
}

function flushPersistentMessages() {
  if (persistenceTimer) {
    clearTimeout(persistenceTimer);
    persistenceTimer = null;
  }

  let saved = 0;
  for (const [key, record] of [...pendingPersistence.entries()]) {
    try {
      database.saveAntideleteMessage(record.chatId, record.messageId, record.payload, record.storedAt);
      pendingPersistence.delete(key);
      saved += 1;
    } catch (error) {
      // Keep the pending record for the retry interval or graceful shutdown.
      reportPersistenceError(error);
    }
  }
  return saved;
}

function getCachedEntry(chatId, messageId) {
  return messageStore.get(chatId)?.get(messageId) || null;
}

function getStoredEntry(chatId, messageId) {
  const cached = getCachedEntry(chatId, messageId);
  if (cached) return cached;

  try {
    const row = database.getAntideleteMessage(chatId, messageId);
    return row ? fromPersistentEntry(row.payload) : null;
  } catch (error) {
    reportPersistenceError(error);
    return null;
  }
}

function removeStoredEntry(chatId, messageId) {
  const chatMap = messageStore.get(chatId);
  if (chatMap) {
    chatMap.delete(messageId);
    if (chatMap.size === 0) messageStore.delete(chatId);
  }
  pendingPersistence.delete(recordKey(chatId, messageId));

  try {
    database.deleteAntideleteMessage(chatId, messageId);
  } catch (error) {
    reportPersistenceError(error);
  }
}

const storeMessage = (msg) => {
  try {
    if (!msg?.key?.id || !msg.message) return;

    const chatId = msg.key.remoteJid;
    if (!chatId || chatId === 'status@broadcast') return;

    const sender = msg.key.participant || msg.key.remoteJid;
    const inner = unwrap(msg.message);
    const text =
      inner.conversation ||
      inner.extendedTextMessage?.text ||
      inner.imageMessage?.caption ||
      inner.videoMessage?.caption ||
      inner.documentMessage?.caption ||
      null;
    const mtype = Object.keys(MEDIA_MAP).find(key => inner[key]);
    if (!text && !mtype) return;

    const entry = {
      sender,
      timestamp: msg.messageTimestamp,
      type: mtype ? MEDIA_MAP[mtype] : 'text',
      mtype: mtype || null,
      inner,
      text: text || null,
    };

    if (!messageStore.has(chatId)) messageStore.set(chatId, new Map());
    const chatMap = messageStore.get(chatId);
    chatMap.set(msg.key.id, entry);
    if (chatMap.size > 500) chatMap.delete(chatMap.keys().next().value);

    // SQLite is the persistent record path; the memory Map remains only the
    // immediate hot cache for messages arriving during this process lifetime.
    queuePersistentMessage(chatId, msg.key.id, entry);
  } catch (_) {}
};

async function downloadMedia(stored) {
  try {
    const { inner, mtype } = stored;
    if (!inner || !mtype || !inner[mtype]) return null;
    const stream = await downloadContentFromMessage(inner[mtype], MEDIA_MAP[mtype]);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
  } catch {
    return null;
  }
}

async function getChatLabel(sock, chatId) {
  try {
    if (chatId.endsWith('@g.us')) {
      const meta = await sock.groupMetadata(chatId);
      return `👥 *${meta.subject}*`;
    }
    return `💬 DM (${chatId.split('@')[0]})`;
  } catch {
    return chatId.endsWith('@g.us')
      ? `👥 Group (${chatId.split('@')[0]})`
      : `💬 DM (${chatId.split('@')[0]})`;
  }
}

async function sendRecovered(sock, targetJid, stored, originChat) {
  const senderNum = stored.sender?.split('@')[0]?.split(':')[0] || 'Unknown';
  const typeEmoji = {
    image: '🖼️', video: '🎬', audio: '🎵',
    sticker: '🧩', document: '📄', text: '📝',
  }[stored.type] || '📝';

  const readmore = String.fromCharCode(8206).repeat(4001);
  const divider = '━━━━━━━━━━━━━━━━━━━━';
  const timestamp = stored.timestamp
    ? new Date(Number(stored.timestamp) * 1000).toLocaleString('en-GB', {
      hour12: false,
      timeZone: getTimezone(),
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
    : new Date().toLocaleString();

  const chatLabel = originChat && originChat !== targetJid
    ? `\n📍 *Chat:* ${await getChatLabel(sock, originChat)}`
    : '';
  const mentions = stored.sender ? [stored.sender] : [];
  const meta =
    `🗑️ *DELETED MESSAGE* 🗑️\n` +
    `${divider}\n` +
    `👤 *From:* @${senderNum}\n` +
    `🕐 *Time:* ${timestamp}\n` +
    `${typeEmoji} *Type:* ${stored.type}` +
    chatLabel + '\n' +
    `${divider}\n${readmore}\n`;

  if (stored.type === 'text') {
    await sock.sendMessage(targetJid, {
      text: `${meta}📝 *Message:*\n${stored.text}\n${divider}`,
      mentions,
    });
    return;
  }

  const buffer = await downloadMedia(stored);
  if (!buffer) {
    await sock.sendMessage(targetJid, {
      text: `${meta}⚠️ _Media expired (CDN link gone)._\n${divider}`,
      mentions,
    });
    return;
  }

  const caption =
    `🗑️ *Deleted Message Recovered*\n${divider}\n` +
    `👤 *From:* @${senderNum}\n` +
    `🕐 *Time:* ${timestamp}\n` +
    `${typeEmoji} *Type:* ${stored.type}` +
    chatLabel +
    (stored.text ? `\n${divider}\n${readmore}\n📝 *Caption:*\n${stored.text}` : '') +
    `\n${divider}`;
  const textHeader = `${meta}${stored.text ? `📝 *Caption:*\n${stored.text}\n` : ''}${divider}`;

  if (stored.type === 'image') {
    await sock.sendMessage(targetJid, { image: buffer, caption, mentions });
  } else if (stored.type === 'video') {
    await sock.sendMessage(targetJid, {
      video: buffer,
      caption,
      mentions,
      mimetype: stored.inner?.videoMessage?.mimetype || 'video/mp4',
    });
  } else if (stored.type === 'audio') {
    const isVoice = stored.inner?.audioMessage?.ptt === true;
    await sock.sendMessage(targetJid, {
      audio: buffer,
      ptt: isVoice,
      mimetype: stored.inner?.audioMessage?.mimetype || 'audio/ogg; codecs=opus',
    });
    await sock.sendMessage(targetJid, { text: textHeader, mentions });
  } else if (stored.type === 'sticker') {
    await sock.sendMessage(targetJid, {
      sticker: buffer,
      mimetype: stored.inner?.stickerMessage?.mimetype || 'image/webp',
    });
    await sock.sendMessage(targetJid, { text: textHeader, mentions });
  } else if (stored.type === 'document') {
    await sock.sendMessage(targetJid, {
      document: buffer,
      mimetype: stored.inner?.documentMessage?.mimetype || 'application/octet-stream',
      fileName: stored.inner?.documentMessage?.fileName || 'file',
      caption,
      mentions,
    });
  }
}

function ownerJid(sock) {
  const id = sock.user?.id;
  if (!id) return null;
  return id.includes(':') ? id.split(':')[0] + '@s.whatsapp.net' : id;
}

const handleDelete = async (sock, revokeItems) => {
  try {
    const globalMode = getMode();
    const botJid = ownerJid(sock);
    if (!globalMode || globalMode === 'off') return;

    for (const item of revokeItems) {
      const chatId = item.key?.remoteJid;
      const deletedId = item.key?.id;
      if (!chatId || !deletedId || chatId === 'status@broadcast') continue;

      const targetJid = globalMode === 'private' && botJid
        ? botJid
        : globalMode === 'chat'
          ? chatId
          : null;
      if (!targetJid) continue;

      const stored = getStoredEntry(chatId, deletedId);
      if (!stored) continue;

      await sendRecovered(sock, targetJid, stored, chatId);
      // A recovered record no longer needs to occupy the capped SQLite store.
      removeStoredEntry(chatId, deletedId);
    }
  } catch (error) {
    console.error('[ANTIDELETE] handleDelete error:', error.message);
  }
};

function getStoreStats() {
  let messages = 0;
  for (const chatMap of messageStore.values()) messages += chatMap.size;
  return {
    mode: getMode(),
    chats: messageStore.size,
    messages,
    pendingPersistence: pendingPersistence.size,
    persistentStore: 'SQLite antidelete_messages',
  };
}

// A short debounce avoids synchronous SQLite writes in the incoming-message
// hot path. The interval retries a temporary database failure without creating
// a second persistent store.
setInterval(flushPersistentMessages, PERSIST_RETRY_INTERVAL_MS).unref();
global.__JUNE_FLUSH_ANTIDELETE = flushPersistentMessages;
process.prependListener('exit', flushPersistentMessages);

module.exports = {
  name: 'antidelete',
  aliases: ['antidel'],
  category: 'owner',
  description: 'Recover deleted messages',
  usage: '.antidelete on/private/off/status',
  adminOnly: true,

  storeMessage,
  handleDelete,
  getStoreStats,
  flush: flushPersistentMessages,
  flushPersistentMessages,

  async execute(sock, msg, args, extra) {
    const { reply } = extra;
    const sub = (args[0] || '').toLowerCase();
    const globalMode = getMode();
    const statusLabel =
      globalMode === 'chat' ? '✅ ON — Chat' :
      globalMode === 'private' ? '✅ ON — Private' : '❌ OFF';

    if (!sub || sub === 'status') {
      return reply(`🗑️ Anti-Delete: *${statusLabel}*\n\n.antidelete on | private | off`);
    }
    if (sub === 'on' || sub === 'chat') {
      database.setAntideleteMode('chat');
      return reply('🗑️ Anti-Delete set to *ON* — deleted msgs shown in each chat.');
    }
    if (sub === 'private') {
      database.setAntideleteMode('private');
      return reply('🗑️ Anti-Delete set to *Private* — all deleted msgs go to owner DM.');
    }
    if (sub === 'off') {
      database.setAntideleteMode('off');
      return reply('🗑️ Anti-Delete set to *OFF*.');
    }
    return reply('⚠️ Usage: .antidelete on | private | off | status');
  },
};
