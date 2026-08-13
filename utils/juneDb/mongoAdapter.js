'use strict';

/**
 * Optional MongoDB persistence for June X.
 *
 * SQLite remains the live local database. MongoDB is a remote mirror/recovery
 * layer enabled only when MONGODB_URI (or MONGO_URL) exists. When the plain
 * auth mirror is active, session credentials and Signal keys are mirrored in a
 * dedicated auth-state record for recovery.
 */

let MongoClient = null;
let client = null;
let mongoDb = null;
let ready = false;
let initializing = null;
let lastError = null;

const COLLECTION = 'june_mirror_records';

function normalizeBotId(value) {
  const raw = String(value || '')
    .trim()
    .split('@')[0]
    .split(':')[0];
  const normalized = raw.replace(/[^a-zA-Z0-9_.-]/g, '-').replace(/-+/g, '-');
  return normalized || 'june-x-main';
}

let activeBotId = normalizeBotId(
  process.env.JUNE_BOT_ID ||
  process.env.BOT_ID ||
  process.env.OWNER_NUMBER ||
  'june-x-main'
);

function getUri() {
  return String(process.env.MONGODB_URI || process.env.MONGO_URL || '').trim();
}

function hasUri() {
  return Boolean(getUri());
}

function getDatabaseName() {
  const value = String(process.env.JUNE_MONGO_DB || process.env.MONGO_DB || 'june_x').trim();
  return value || 'june_x';
}

function getBotId() {
  return activeBotId;
}

function setBotId(value) {
  if (value) activeBotId = normalizeBotId(value);
  return activeBotId;
}

function getStatus() {
  return {
    configured: hasUri(),
    available: ready,
    collection: COLLECTION,
    database: getDatabaseName(),
    botId: activeBotId,
    lastError,
  };
}

function collection() {
  return mongoDb?.collection(COLLECTION) || null;
}

function recordId(kind, parts = []) {
  return [kind, activeBotId, ...parts.map((part) => String(part))]
    .map((part) => encodeURIComponent(part))
    .join('|');
}

function runRemoteOperation(operation) {
  if (!ready || !collection()) return Promise.resolve(null);
  return Promise.resolve()
    .then(operation)
    .catch((error) => {
      lastError = error?.message || String(error);
      return null;
    });
}

function upsertRecord(kind, parts, data) {
  const _id = recordId(kind, parts);
  return runRemoteOperation(() => collection().updateOne(
    { _id },
    {
      $set: {
        kind,
        botId: activeBotId,
        data: data || {},
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  ));
}

function deleteRecord(kind, parts) {
  return runRemoteOperation(() => collection().deleteOne({ _id: recordId(kind, parts) }));
}

async function ensureIndexes() {
  const records = collection();
  if (!records) return;
  await Promise.all([
    records.createIndex({ botId: 1, kind: 1, updatedAt: -1 }),
    records.createIndex({ kind: 1, updatedAt: -1 }),
  ]);
}

async function init() {
  if (ready) return getStatus();
  if (initializing) return initializing;

  initializing = (async () => {
    if (!hasUri()) return getStatus();

    try {
      ({ MongoClient } = require('mongodb'));
      if (!MongoClient) throw new Error('MongoClient constructor was not found');
    } catch (error) {
      lastError = 'The mongodb package is not installed';
      console.warn(`[MONGO] Optional MongoDB disabled: ${lastError}`);
      return getStatus();
    }

    let candidate = null;
    try {
      candidate = new MongoClient(getUri(), {
        maxPoolSize: Number(process.env.JUNE_MONGO_POOL_MAX) || 5,
        serverSelectionTimeoutMS: Number(process.env.JUNE_MONGO_CONNECT_TIMEOUT_MS) || 8000,
        connectTimeoutMS: Number(process.env.JUNE_MONGO_CONNECT_TIMEOUT_MS) || 8000,
        retryWrites: true,
      });
      await candidate.connect();
      client = candidate;
      mongoDb = client.db(getDatabaseName());
      await ensureIndexes();
      ready = true;
      lastError = null;
      console.log(`[MONGO] Connected; remote persistence enabled for bot_id=${activeBotId}`);
    } catch (error) {
      lastError = error?.message || String(error);
      console.warn(`[MONGO] Optional MongoDB unavailable: ${lastError}`);
      try { await candidate?.close(); } catch (_) {}
      client = null;
      mongoDb = null;
      ready = false;
    }

    return getStatus();
  })().finally(() => {
    initializing = null;
  });

  return initializing;
}

function mirrorBotSetting(key, value) {
  return upsertRecord('bot-setting', [key], { key: String(key), value });
}

function mirrorGroupSettings(groupId, settings) {
  return upsertRecord('group-settings', [groupId], { groupId: String(groupId), settings: settings || {} });
}

function mirrorGroupStat(groupId, date, data) {
  return upsertRecord('group-stat', [groupId, date], {
    groupId: String(groupId),
    date: String(date),
    data: data || {},
  });
}

function mirrorUser(userId, data) {
  return upsertRecord('user', [userId], { userId: String(userId), data: data || {} });
}

function mirrorWarning(groupId, userId, warning) {
  return upsertRecord('warning', [groupId, userId], {
    groupId: String(groupId),
    userId: String(userId),
    count: Number(warning?.count || 0),
    entries: warning?.entries || [],
  });
}

function mirrorModerator(userId, enabled = true) {
  if (!enabled) return deleteRecord('moderator', [userId]);
  return upsertRecord('moderator', [userId], { userId: String(userId) });
}

function mirrorMutedUser(groupId, userId, enabled = true) {
  if (!enabled) return deleteRecord('muted-user', [groupId, userId]);
  return upsertRecord('muted-user', [groupId, userId], {
    groupId: String(groupId),
    userId: String(userId),
  });
}

function mirrorKV(namespace, key, value) {
  return upsertRecord('kv', [namespace, key], {
    namespace: String(namespace),
    key: String(key),
    value,
  });
}

function deleteKV(namespace, key) {
  return deleteRecord('kv', [namespace, key]);
}

function mirrorAntideleteMessage(chatId, messageId, payload, storedAt = Date.now()) {
  return upsertRecord('antidelete-message', [chatId, messageId], {
    chatId: String(chatId),
    messageId: String(messageId),
    payload: payload || {},
    storedAt: Number(storedAt),
  });
}

function deleteAntideleteMessage(chatId, messageId) {
  return deleteRecord('antidelete-message', [chatId, messageId]);
}

function mirrorAntideleteStatus(statusId, payload, storedAt = Date.now()) {
  return upsertRecord('antidelete-status', [statusId], {
    statusId: String(statusId),
    payload: payload || {},
    storedAt: Number(storedAt),
  });
}

function deleteAntideleteStatus(statusId) {
  return deleteRecord('antidelete-status', [statusId]);
}

function mirrorLidMap(direction, user, value, updatedAt = Date.now()) {
  return upsertRecord('lid-map', [direction, user], {
    direction: String(direction),
    user: String(user),
    value: String(value),
    updatedAt: Number(updatedAt),
  });
}

function mirrorProfile(profileBotId, userId, profile) {
  return upsertRecord('chat-profile', [profileBotId, userId], {
    profileBotId: String(profileBotId || 'default'),
    userId: String(userId),
    profile: profile || {},
  });
}

// Direct auth-state mirror. This mode intentionally stores the verified local
// auth snapshot as-is in the remote collection; it uses no encryption key.
function mirrorAuthState(snapshot) {
  return upsertRecord('auth-state', [], snapshot || {}).then((result) => {
    if (!result) return result;
    // Once the new state is written, remove the prior implementation's stale
    // auth record for this bot if it still exists.
    return deleteLegacyAuthRecord().then(() => result);
  });
}

function fetchAuthState() {
  if (!ready || !collection()) return Promise.resolve(null);
  return runRemoteOperation(async () => {
    const document = await collection().findOne({ _id: recordId('auth-state', []) });
    if (!document?.data) return null;
    return {
      snapshot: document.data,
      updatedAt: document.updatedAt ? new Date(document.updatedAt).getTime() : 0,
      source: 'mongo',
    };
  });
}

function deleteAuthState() {
  return deleteRecord('auth-state', []);
}

// Compatibility cleanup only. This is never read as auth state by this version.
function deleteLegacyAuthRecord() {
  return deleteRecord('auth-backup', []);
}

function insertIfMissing(sqlite, existsSql, existsArgs, insertSql, insertArgs) {
  if (sqlite.prepare(existsSql).get(...existsArgs)) return false;
  sqlite.prepare(insertSql).run(...insertArgs);
  return true;
}

async function restoreIntoSQLite(sqlite) {
  if (!ready || !mongoDb || !sqlite) {
    return { restored: 0, skipped: 'mongo_unavailable' };
  }

  try {
    const documents = await collection()
      .find({ botId: activeBotId })
      .sort({ updatedAt: 1 })
      .toArray();
    let restored = 0;

    const restore = sqlite.transaction(() => {
      for (const document of documents) {
        const data = document?.data || {};
        try {
          let inserted = false;
          switch (document.kind) {
            case 'bot-setting':
              inserted = insertIfMissing(
                sqlite,
                'SELECT 1 FROM bot_settings WHERE key = ?', [data.key],
                'INSERT INTO bot_settings (key, value) VALUES (?, ?)',
                [data.key, JSON.stringify(data.value)]
              );
              break;
            case 'group-settings':
              inserted = insertIfMissing(
                sqlite,
                'SELECT 1 FROM groups WHERE group_id = ?', [data.groupId],
                'INSERT INTO groups (group_id, settings) VALUES (?, ?)',
                [data.groupId, JSON.stringify(data.settings || {})]
              );
              break;
            case 'group-stat':
              inserted = insertIfMissing(
                sqlite,
                'SELECT 1 FROM group_stats WHERE group_id = ? AND date = ?', [data.groupId, data.date],
                'INSERT INTO group_stats (group_id, date, data) VALUES (?, ?, ?)',
                [data.groupId, data.date, JSON.stringify(data.data || {})]
              );
              break;
            case 'user':
              inserted = insertIfMissing(
                sqlite,
                'SELECT 1 FROM users WHERE user_id = ?', [data.userId],
                'INSERT INTO users (user_id, data) VALUES (?, ?)',
                [data.userId, JSON.stringify(data.data || {})]
              );
              break;
            case 'warning':
              inserted = insertIfMissing(
                sqlite,
                'SELECT 1 FROM warnings WHERE group_id = ? AND user_id = ?', [data.groupId, data.userId],
                'INSERT INTO warnings (group_id, user_id, count, entries) VALUES (?, ?, ?, ?)',
                [data.groupId, data.userId, Number(data.count || 0), JSON.stringify(data.entries || [])]
              );
              break;
            case 'moderator':
              inserted = insertIfMissing(
                sqlite,
                'SELECT 1 FROM moderators WHERE user_id = ?', [data.userId],
                'INSERT INTO moderators (user_id) VALUES (?)', [data.userId]
              );
              break;
            case 'muted-user':
              inserted = insertIfMissing(
                sqlite,
                'SELECT 1 FROM muted_users WHERE group_id = ? AND user_id = ?', [data.groupId, data.userId],
                'INSERT INTO muted_users (group_id, user_id) VALUES (?, ?)', [data.groupId, data.userId]
              );
              break;
            case 'kv':
              if (data.namespace === 'runtime_telemetry' && data.value?.eventType) {
                const event = data.value;
                inserted = insertIfMissing(
                  sqlite,
                  'SELECT 1 FROM runtime_telemetry WHERE event_type = ? AND event_key = ?',
                  [event.eventType, event.eventKey],
                  `INSERT INTO runtime_telemetry
                    (event_type, event_key, payload, count, first_seen, last_seen)
                   VALUES (?, ?, ?, ?, ?, ?)`,
                  [
                    event.eventType,
                    event.eventKey,
                    JSON.stringify(event.payload || {}),
                    Number(event.count || 1),
                    Number(event.firstSeen || Date.now()),
                    Number(event.lastSeen || Date.now()),
                  ]
                );
              } else {
                inserted = insertIfMissing(
                  sqlite,
                  'SELECT 1 FROM kv_store WHERE namespace = ? AND key = ?', [data.namespace, data.key],
                  'INSERT INTO kv_store (namespace, key, value) VALUES (?, ?, ?)',
                  [data.namespace, data.key, JSON.stringify(data.value)]
                );
              }
              break;
            case 'antidelete-message':
              inserted = insertIfMissing(
                sqlite,
                'SELECT 1 FROM antidelete_messages WHERE chat_id = ? AND message_id = ?', [data.chatId, data.messageId],
                'INSERT INTO antidelete_messages (chat_id, message_id, payload, stored_at) VALUES (?, ?, ?, ?)',
                [data.chatId, data.messageId, JSON.stringify(data.payload || {}), Number(data.storedAt || Date.now())]
              );
              break;
            case 'antidelete-status':
              inserted = insertIfMissing(
                sqlite,
                'SELECT 1 FROM antidelete_statuses WHERE status_id = ?', [data.statusId],
                'INSERT INTO antidelete_statuses (status_id, payload, stored_at) VALUES (?, ?, ?)',
                [data.statusId, JSON.stringify(data.payload || {}), Number(data.storedAt || Date.now())]
              );
              break;
            case 'lid-map':
              inserted = insertIfMissing(
                sqlite,
                'SELECT 1 FROM lid_map WHERE direction = ? AND user = ?', [data.direction, data.user],
                'INSERT INTO lid_map (direction, user, value, updated_at) VALUES (?, ?, ?, ?)',
                [data.direction, data.user, data.value, Number(data.updatedAt || Date.now())]
              );
              break;
            case 'chat-profile':
              inserted = insertIfMissing(
                sqlite,
                'SELECT 1 FROM chat_profiles WHERE bot_id = ? AND user_id = ?', [data.profileBotId, data.userId],
                'INSERT INTO chat_profiles (bot_id, user_id, profile) VALUES (?, ?, ?)',
                [data.profileBotId, data.userId, JSON.stringify(data.profile || {})]
              );
              break;
            default:
              break;
          }
          if (inserted) restored += 1;
        } catch (_) {}
      }
    });

    restore();
    return { restored, botId: activeBotId };
  } catch (error) {
    lastError = error?.message || String(error);
    console.warn(`[MONGO] Restore skipped: ${lastError}`);
    return { restored: 0, error: lastError };
  }
}

async function close() {
  const activeClient = client;
  client = null;
  mongoDb = null;
  ready = false;
  if (!activeClient) return;
  try { await activeClient.close(); } catch (_) {}
}

module.exports = {
  init,
  close,
  getBotId,
  setBotId,
  getStatus,
  mirrorBotSetting,
  mirrorGroupSettings,
  mirrorGroupStat,
  mirrorUser,
  mirrorWarning,
  mirrorModerator,
  mirrorMutedUser,
  mirrorKV,
  deleteKV,
  mirrorAntideleteMessage,
  deleteAntideleteMessage,
  mirrorAntideleteStatus,
  deleteAntideleteStatus,
  mirrorLidMap,
  mirrorProfile,
  mirrorAuthState,
  fetchAuthState,
  deleteAuthState,
  deleteLegacyAuthRecord,
  restoreIntoSQLite,
};
