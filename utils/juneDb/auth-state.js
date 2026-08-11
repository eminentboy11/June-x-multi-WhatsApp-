/**
 * SQLite-backed Baileys authentication for June X.
 *
 * The legacy `session` table remains untouched for compatibility. This module
 * stores the complete Baileys auth state separately in session_creds and
 * session_keys, and refuses to use a migration until it has been verified.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const AUTH_META = {
  status: 'status',
  sourceKeyFiles: 'source_key_files',
  databaseKeyRows: 'database_key_rows',
  sourceJsonFiles: 'source_json_files',
  quarantinedPath: 'quarantined_path',
  migratedAt: 'migrated_at',
  pendingFileMigration: 'pending_file_migration',
  // SHA-256 fingerprint only — the raw SESSION_ID is never stored or logged.
  sessionIdFingerprint: 'session_id_fingerprint',
  sessionIdRevokedFingerprint: 'session_id_revoked_fingerprint',
};

const KEY_TYPES = [
  'app-state-sync-version',
  'app-state-sync-key',
  'sender-key-memory',
  'sender-key',
  'identity-key',
  'device-list',
  'lid-mapping',
  'pre-key',
  'session',
  'tctoken',
];

const CORE_KEY_TYPES = new Set([
  'pre-key',
  'session',
  'identity-key',
  'sender-key',
  'sender-key-memory',
  'app-state-sync-key',
]);

let baileysDepsPromise = null;

async function getBaileysDeps() {
  if (!baileysDepsPromise) {
    baileysDepsPromise = import('@whiskeysockets/baileys').then((baileys) => ({
      proto: baileys.proto,
      BufferJSON: baileys.BufferJSON,
      initAuthCreds: baileys.initAuthCreds,
    }));
  }
  return baileysDepsPromise;
}

function ensureAuthSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_creds (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session_keys (
      type       TEXT NOT NULL,
      id         TEXT NOT NULL,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (type, id)
    );
    CREATE INDEX IF NOT EXISTS idx_session_keys_type ON session_keys(type);
    CREATE TABLE IF NOT EXISTS session_auth_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

function setMeta(db, key, value) {
  if (value === null || value === undefined) {
    db.prepare('DELETE FROM session_auth_meta WHERE key = ?').run(key);
    return;
  }
  db.prepare(`
    INSERT INTO session_auth_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

function getMeta(db, key) {
  const value = db.prepare('SELECT value FROM session_auth_meta WHERE key = ?').get(key)?.value;
  return value === undefined || value === '' || value === 'null' ? null : value;
}

function getSessionIdFingerprint(db) {
  ensureAuthSchema(db);
  return getMeta(db, AUTH_META.sessionIdFingerprint);
}

function setSessionIdFingerprint(db, fingerprint) {
  ensureAuthSchema(db);
  setMeta(db, AUTH_META.sessionIdFingerprint, fingerprint || null);
}

function getSessionIdRevokedFingerprint(db) {
  ensureAuthSchema(db);
  return getMeta(db, AUTH_META.sessionIdRevokedFingerprint);
}

function setSessionIdRevokedFingerprint(db, fingerprint) {
  ensureAuthSchema(db);
  setMeta(db, AUTH_META.sessionIdRevokedFingerprint, fingerprint || null);
}

function getSQLiteAuthStats(db) {
  ensureAuthSchema(db);
  const byType = db.prepare(
    'SELECT type, COUNT(*) AS count FROM session_keys GROUP BY type ORDER BY type'
  ).all();
  return {
    verified: getMeta(db, AUTH_META.status) === 'verified',
    hasCreds: !!db.prepare("SELECT 1 FROM session_creds WHERE key = 'creds'").get(),
    totalKeys: db.prepare('SELECT COUNT(*) AS count FROM session_keys').get().count,
    sourceKeyFiles: Number(getMeta(db, AUTH_META.sourceKeyFiles) || 0),
    databaseKeyRows: Number(getMeta(db, AUTH_META.databaseKeyRows) || 0),
    sourceJsonFiles: Number(getMeta(db, AUTH_META.sourceJsonFiles) || 0),
    quarantinedPath: getMeta(db, AUTH_META.quarantinedPath),
    migratedAt: getMeta(db, AUTH_META.migratedAt),
    pendingFileMigration: getMeta(db, AUTH_META.pendingFileMigration) === '1',
    invalidReason: getMeta(db, 'invalid_reason'),
    byType,
  };
}

function hasVerifiedSQLiteAuth(db) {
  const stats = getSQLiteAuthStats(db);
  // The migration count is an audit record, not a permanent invariant:
  // Baileys legitimately creates and removes signal keys during normal use.
  return stats.verified && stats.hasCreds;
}

function invalidateSQLiteAuth(db, reason = 'file-auth-priority') {
  ensureAuthSchema(db);
  setMeta(db, AUTH_META.status, 'invalid');
  setMeta(db, 'invalid_reason', reason);
  setMeta(db, AUTH_META.pendingFileMigration, '0');
}

function isObjectValue(value) {
  return value !== null && typeof value === 'object';
}

function removeInvalidLidMapping(db, type, id, onMutation) {
  if (type !== 'lid-mapping') return false;
  try {
    db.prepare('DELETE FROM session_keys WHERE type = ? AND id = ?').run(type, id);
    setMeta(db, 'last_lid_mapping_repair_count', 1);
    setMeta(db, 'last_lid_mapping_repair_at', Date.now());
    if (typeof onMutation === 'function') onMutation('auth-lid-mapping-repair');
  } catch (_) {}
  return true;
}

function parseKeyFilename(filename) {
  if (!filename.endsWith('.json') || filename === 'creds.json') return null;
  const base = filename.slice(0, -'.json'.length);
  const type = KEY_TYPES.find((candidate) => base.startsWith(`${candidate}-`));
  if (!type) return null;
  const encodedId = base.slice(type.length + 1);
  if (!encodedId) return null;
  return {
    type,
    id: encodedId.replace(/__/g, '/').replace(/-/g, ':'),
  };
}

function copyToQuarantine(sessionDir) {
  const quarantinePath = `${sessionDir}.quarantine-${Date.now()}`;
  fs.renameSync(sessionDir, quarantinePath);
  return quarantinePath;
}

function defaultQuarantineRetentionDays() {
  const raw = process.env.JUNE_SESSION_QUARANTINE_RETENTION_DAYS;
  // Keep one day by default. An explicit 0 disables age-based cleanup.
  if (raw === undefined || String(raw).trim() === '') return 1;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 1;
}

function defaultQuarantineMaxCount() {
  const raw = process.env.JUNE_SESSION_QUARANTINE_MAX_COUNT;
  // Keep a small rollback window even when many restarts happen in one day.
  if (raw === undefined || String(raw).trim() === '') return 3;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 3;
}

function cleanupSessionQuarantines(
  sessionDir,
  retentionDays = defaultQuarantineRetentionDays(),
  maxCount = defaultQuarantineMaxCount()
) {
  const days = Number(retentionDays);
  const limit = Number(maxCount);
  const ageCleanupEnabled = Number.isFinite(days) && days > 0;
  const countCleanupEnabled = Number.isFinite(limit) && limit > 0;

  if (!ageCleanupEnabled && !countCleanupEnabled) {
    return {
      enabled: false,
      retentionDays: days,
      maxCount: limit,
      removed: [],
      skipped: 'disabled',
    };
  }

  const parentDir = path.dirname(sessionDir);
  if (!fs.existsSync(parentDir)) {
    return { enabled: true, retentionDays: days, maxCount: limit, removed: [], retained: 0 };
  }

  const baseName = path.basename(sessionDir);
  const cutoff = ageCleanupEnabled
    ? Date.now() - days * 24 * 60 * 60 * 1000
    : null;
  const candidates = [];

  for (const name of fs.readdirSync(parentDir)) {
    if (!name.startsWith(`${baseName}.quarantine-`) && !name.startsWith(`${baseName}.incomplete-`)) {
      continue;
    }
    const candidate = path.join(parentDir, name);
    try {
      const stats = fs.statSync(candidate);
      if (!stats.isDirectory()) continue;
      const stamp = Number(name.match(/-(\d+)$/)?.[1] || 0);
      candidates.push({ path: candidate, mtimeMs: stats.mtimeMs, stamp });
    } catch (_) {}
  }

  // Newest first: mtime is primary, timestamp in the quarantine name resolves ties.
  candidates.sort((left, right) =>
    right.mtimeMs - left.mtimeMs || right.stamp - left.stamp
  );

  const removed = [];
  let removedByRetention = 0;
  let removedByLimit = 0;
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const expired = ageCleanupEnabled && candidate.mtimeMs < cutoff;
    const exceedsLimit = countCleanupEnabled && index >= limit;
    if (!expired && !exceedsLimit) continue;

    try {
      fs.rmSync(candidate.path, { recursive: true, force: true });
      removed.push(candidate.path);
      if (expired) removedByRetention += 1;
      else if (exceedsLimit) removedByLimit += 1;
    } catch (_) {}
  }

  return {
    enabled: true,
    retentionDays: days,
    maxCount: limit,
    removed,
    retained: Math.max(0, candidates.length - removed.length),
    removedByRetention,
    removedByLimit,
  };
}

function getSessionQuarantineStats(sessionDir) {
  const parentDir = path.dirname(sessionDir);
  const baseName = path.basename(sessionDir);
  if (!fs.existsSync(parentDir)) return { count: 0, newestAt: null, paths: [] };

  const entries = [];
  for (const name of fs.readdirSync(parentDir)) {
    if (!name.startsWith(`${baseName}.quarantine-`) && !name.startsWith(`${baseName}.incomplete-`)) {
      continue;
    }
    const candidate = path.join(parentDir, name);
    try {
      const stats = fs.statSync(candidate);
      if (stats.isDirectory()) entries.push({ path: candidate, mtimeMs: stats.mtimeMs });
    } catch (_) {}
  }
  entries.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return {
    count: entries.length,
    newestAt: entries[0]?.mtimeMs || null,
    paths: entries.map((entry) => entry.path),
  };
}

async function readStableJson(filePath, BufferJSON, attempts = 3) {
  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const before = fs.statSync(filePath);
      const raw = fs.readFileSync(filePath, 'utf8');
      const after = fs.statSync(filePath);

      // Baileys can be writing a key file while migration scans the folder.
      // Do not parse a file whose size or mtime changed during the read.
      if (
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs
      ) {
        lastError = new Error('file changed while it was being read');
      } else {
        return JSON.parse(raw, BufferJSON.reviver);
      }
    } catch (error) {
      lastError = error;
    }

    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  throw lastError || new Error('could not read JSON file');
}

async function migrateFilesToSQLite(db, sessionDir, options = {}) {
  const { BufferJSON } = await getBaileysDeps();
  ensureAuthSchema(db);

  if (!fs.existsSync(sessionDir) || !fs.statSync(sessionDir).isDirectory()) {
    throw new Error(`AUTH_MIGRATION_NO_SESSION_DIR: ${sessionDir}`);
  }

  const credsPath = path.join(sessionDir, 'creds.json');
  if (!fs.existsSync(credsPath)) {
    throw new Error('AUTH_MIGRATION_NO_CREDS: creds.json is missing');
  }

  let creds;
  try {
    creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'), BufferJSON.reviver);
    if (!creds || typeof creds !== 'object') throw new Error('credentials are not an object');
  } catch (error) {
    throw new Error(`AUTH_MIGRATION_INVALID_CREDS: ${error.message}`);
  }

  const files = fs.readdirSync(sessionDir);
  const keyFiles = files.map(parseKeyFilename).filter(Boolean);
  if (keyFiles.length === 0) {
    throw new Error('AUTH_MIGRATION_NO_KEY_FILES: only creds.json is available');
  }
  const unknownJsonFiles = files.filter((file) =>
    file.endsWith('.json') && file !== 'creds.json' && !parseKeyFilename(file)
  );
  if (unknownJsonFiles.length > 0) {
    throw new Error(`AUTH_MIGRATION_UNKNOWN_FILES: ${unknownJsonFiles.join(', ')}`);
  }
  const entries = [];
  const skippedOptionalFiles = [];
  for (const descriptor of keyFiles) {
    const filename = `${descriptor.type}-${descriptor.id
      .replace(/\//g, '__')
      .replace(/:/g, '-')}.json`;
    // Use the actual source filename so IDs containing encoding characters
    // are not reconstructed differently from the files on disk.
    const sourceName = files.find((file) => {
      const parsed = parseKeyFilename(file);
      return parsed && parsed.type === descriptor.type && parsed.id === descriptor.id;
    });
    if (!sourceName) throw new Error(`AUTH_MIGRATION_SOURCE_NOT_FOUND: ${filename}`);
    try {
      const value = await readStableJson(
        path.join(sessionDir, sourceName),
        BufferJSON
      );
      entries.push({ type: descriptor.type, id: descriptor.id, value: JSON.stringify(value, BufferJSON.replacer) });
    } catch (error) {
      // LID mapping files are auxiliary cache files, not Signal credentials.
      // A partially-written mapping must not block the live file-auth session.
      if (descriptor.type === 'lid-mapping') {
        skippedOptionalFiles.push(sourceName);
        continue;
      }
      throw new Error(`AUTH_MIGRATION_INVALID_KEY ${sourceName}: ${error.message}`);
    }
  }

  if (entries.length === 0) {
    throw new Error(
      skippedOptionalFiles.length > 0
        ? `AUTH_MIGRATION_NO_VALID_KEY_FILES: skipped ${skippedOptionalFiles.join(', ')}`
        : 'AUTH_MIGRATION_NO_KEY_FILES: no usable key files were found'
    );
  }

  const now = Date.now();
  const replace = options.replace === true;
  const insertCreds = db.prepare(`
    INSERT INTO session_creds (key, value, updated_at) VALUES ('creds', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  const insertKey = db.prepare(`
    INSERT INTO session_keys (type, id, value, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(type, id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  const write = db.transaction(() => {
    if (replace) {
      db.prepare('DELETE FROM session_creds').run();
      db.prepare('DELETE FROM session_keys').run();
    }
    insertCreds.run(JSON.stringify(creds, BufferJSON.replacer), now);
    for (const entry of entries) insertKey.run(entry.type, entry.id, entry.value, now);
    setMeta(db, AUTH_META.status, 'verifying');
    setMeta(db, AUTH_META.sourceKeyFiles, entries.length);
    setMeta(db, AUTH_META.databaseKeyRows, entries.length);
    setMeta(db, AUTH_META.sourceJsonFiles, files.filter((file) => file.endsWith('.json')).length);
    setMeta(db, 'unknown_json_files', unknownJsonFiles.length);
  });
  write();

  const stats = getSQLiteAuthStats(db);
  if (!stats.hasCreds || stats.totalKeys !== entries.length || stats.sourceKeyFiles !== entries.length) {
    setMeta(db, AUTH_META.status, 'invalid');
    throw new Error(`AUTH_MIGRATION_COUNT_MISMATCH: source=${entries.length}, database=${stats.totalKeys}`);
  }

  // Parse every stored row again before trusting the database-backed state.
  const storedCreds = db.prepare("SELECT value FROM session_creds WHERE key = 'creds'").get();
  JSON.parse(storedCreds.value, BufferJSON.reviver);
  for (const row of db.prepare('SELECT value FROM session_keys').all()) {
    JSON.parse(row.value, BufferJSON.reviver);
  }

  let quarantinedPath = null;
  if (options.quarantine !== false) {
    try {
      quarantinedPath = copyToQuarantine(sessionDir);
    } catch (error) {
      setMeta(db, AUTH_META.status, 'invalid');
      throw new Error(`AUTH_MIGRATION_QUARANTINE_FAILED: ${error.message}`);
    }
  }

  setMeta(db, AUTH_META.status, 'verified');
  setMeta(db, AUTH_META.quarantinedPath, quarantinedPath);
  setMeta(db, AUTH_META.migratedAt, now);
  setMeta(db, AUTH_META.pendingFileMigration, options.quarantine === false ? '1' : '0');
  setMeta(db, 'invalid_reason', null);
  if (typeof options.onMutation === 'function') options.onMutation('auth-migration');

  return {
    ok: true,
    stats: getSQLiteAuthStats(db),
    quarantinedPath,
    skippedOptionalFiles,
  };
}

async function validateSQLiteAuth(db, options = {}) {
  const { proto, BufferJSON } = await getBaileysDeps();
  ensureAuthSchema(db);
  const stats = getSQLiteAuthStats(db);
  const wasVerified = stats.verified;
  const repairedLidMappings = [];

  const fail = (code, detail) => {
    const reason = `${code}: ${detail}`;
    if (wasVerified && options.markInvalid !== false) {
      invalidateSQLiteAuth(db, reason);
    }
    return {
      ok: false,
      wasVerified,
      code,
      reason,
      stats: getSQLiteAuthStats(db),
    };
  };

  if (!wasVerified) {
    return {
      ok: false,
      wasVerified: false,
      code: 'AUTH_NOT_VERIFIED',
      reason: 'SQLite auth is not marked verified.',
      stats,
    };
  }

  const credsRow = db.prepare("SELECT value FROM session_creds WHERE key = 'creds'").get();
  if (!credsRow) return fail('AUTH_CREDS_MISSING', 'session_creds does not contain creds.');

  try {
    const creds = JSON.parse(credsRow.value, BufferJSON.reviver);
    if (!creds || typeof creds !== 'object') {
      return fail('AUTH_CREDS_INVALID', 'stored credentials are not an object.');
    }
  } catch (error) {
    return fail('AUTH_CREDS_INVALID', error.message);
  }

  const rows = db.prepare('SELECT type, id, value FROM session_keys ORDER BY type, id').all();
  if (stats.sourceKeyFiles > 0 && rows.length === 0) {
    return fail('AUTH_KEYS_MISSING', `migration recorded ${stats.sourceKeyFiles} source key files but SQLite has none.`);
  }

  const presentTypes = new Set();
  for (const row of rows) {
    if (!KEY_TYPES.includes(row.type)) {
      return fail('AUTH_KEY_TYPE_UNKNOWN', `unsupported key type "${row.type}".`);
    }
    if (!row.id) {
      if (row.type === 'lid-mapping') {
        repairedLidMappings.push(row);
        continue;
      }
      return fail('AUTH_KEY_ID_MISSING', `key type "${row.type}" has an empty ID.`);
    }
    try {
      const value = JSON.parse(row.value, BufferJSON.reviver);
      if (value === null || typeof value !== 'object') {
        if (row.type === 'lid-mapping') {
          repairedLidMappings.push(row);
          continue;
        }
        return fail('AUTH_KEY_INVALID', `${row.type}/${row.id} is not an object.`);
      }
      if (row.type === 'app-state-sync-key') {
        proto.Message.AppStateSyncKeyData.create(value);
      }
    } catch (error) {
      // LID mappings are auxiliary cache data. A partially-written mapping
      // must not invalidate the complete SQLite Signal auth state.
      if (row.type === 'lid-mapping') {
        repairedLidMappings.push(row);
        continue;
      }
      return fail('AUTH_KEY_INVALID', `${row.type}/${row.id}: ${error.message}`);
    }
    presentTypes.add(row.type);
  }

  if (repairedLidMappings.length > 0) {
    const deleteRow = db.prepare('DELETE FROM session_keys WHERE type = ? AND id = ?');
    const repair = db.transaction(() => {
      for (const row of repairedLidMappings) {
        deleteRow.run(row.type, row.id || '');
      }
      setMeta(db, 'last_lid_mapping_repair_count', repairedLidMappings.length);
      setMeta(db, 'last_lid_mapping_repair_at', Date.now());
    });
    repair();
    if (typeof options.onMutation === 'function') {
      options.onMutation('auth-lid-mapping-repair');
    }
  }

  if (stats.sourceKeyFiles > 0 && ![...CORE_KEY_TYPES].some((type) => presentTypes.has(type))) {
    return fail('AUTH_KEY_TYPES_INCOMPLETE', `no core Signal key type is present; found ${[...presentTypes].join(', ') || 'none'}.`);
  }

  return {
    ok: true,
    wasVerified: true,
    code: 'AUTH_VALID',
    reason: 'SQLite credentials and key rows validated.',
    stats: getSQLiteAuthStats(db),
    repairedLidMappings: repairedLidMappings.length,
  };
}

async function finalizePendingFileMigration(db, sessionDir, options = {}) {
  ensureAuthSchema(db);
  if (getMeta(db, AUTH_META.pendingFileMigration) !== '1') {
    return { ok: false, skipped: true, reason: 'no-pending-file-migration' };
  }
  return migrateFilesToSQLite(db, sessionDir, {
    replace: true,
    quarantine: true,
    onMutation: options.onMutation,
  });
}

async function useSQLiteAuthState(db, sessionDir, options = {}) {
  const { proto, BufferJSON, initAuthCreds } = await getBaileysDeps();
  ensureAuthSchema(db);

  if (!hasVerifiedSQLiteAuth(db)) {
    const credsPath = path.join(sessionDir, 'creds.json');
    const status = getMeta(db, AUTH_META.status);
    const invalidReason = getMeta(db, 'invalid_reason');
    const canFreshStart = options.allowFresh === true
      && !fs.existsSync(credsPath)
      && (status !== 'invalid' || options.allowFreshAfterInvalid === true);
    if (canFreshStart) {
      const freshCreds = initAuthCreds();
      const now = Date.now();
      db.prepare(`
        INSERT INTO session_creds (key, value, updated_at) VALUES ('creds', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(JSON.stringify(freshCreds, BufferJSON.replacer), now);
      setMeta(db, AUTH_META.status, 'verified');
      setMeta(db, AUTH_META.sourceKeyFiles, 0);
      setMeta(db, AUTH_META.databaseKeyRows, 0);
      setMeta(db, AUTH_META.sourceJsonFiles, 0);
      setMeta(db, AUTH_META.migratedAt, now);
      if (typeof options.onMutation === 'function') options.onMutation('auth-fresh-init');
    } else {
      await migrateFilesToSQLite(db, sessionDir, {
        // Any unverified state is disposable migration residue. Rebuild it
        // from the source folder so counts describe this import exactly.
        replace: true,
        onMutation: options.onMutation,
      });
    }
  }

  if (!hasVerifiedSQLiteAuth(db)) {
    throw new Error('AUTH_STATE_NOT_VERIFIED');
  }

  function readCreds() {
    const row = db.prepare("SELECT value FROM session_creds WHERE key = 'creds'").get();
    return row ? JSON.parse(row.value, BufferJSON.reviver) : initAuthCreds();
  }

  function readKey(type, id) {
    const row = db.prepare('SELECT value FROM session_keys WHERE type = ? AND id = ?').get(type, id);
    if (!row) return null;
    try {
      const value = JSON.parse(row.value, BufferJSON.reviver);
      if (!isObjectValue(value) && removeInvalidLidMapping(db, type, id, options.onMutation)) {
        //console.warn(`[ AUTH ] Removed malformed runtime LID mapping ${type}/${id}.`);
        return null;
      }
      return value;
    } catch (error) {
      if (removeInvalidLidMapping(db, type, id, options.onMutation)) {
       // console.warn(`[ AUTH ] Removed unreadable runtime LID mapping ${type}/${id}.`);
        return null;
      }
      throw error;
    }
  }

  function writeCreds(creds) {
    db.prepare(`
      INSERT INTO session_creds (key, value, updated_at) VALUES ('creds', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(JSON.stringify(creds, BufferJSON.replacer), Date.now());
    if (typeof options.onMutation === 'function') options.onMutation('auth-creds');
  }

  const creds = readCreds();
  return {
    source: 'sqlite',
    stats: getSQLiteAuthStats(db),
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          for (const id of ids) {
            let value = readKey(type, id);
            if (type === 'app-state-sync-key' && value) {
              value = proto.Message.AppStateSyncKeyData.create(value);
            }
            data[id] = value;
          }
          return data;
        },
        set: async (data) => {
          const writeKey = db.prepare(`
            INSERT INTO session_keys (type, id, value, updated_at) VALUES (?, ?, ?, ?)
            ON CONFLICT(type, id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
          `);
          const deleteKey = db.prepare('DELETE FROM session_keys WHERE type = ? AND id = ?');
          const transaction = db.transaction(() => {
            for (const [type, values] of Object.entries(data)) {
              for (const [id, value] of Object.entries(values)) {
                if (!value) {
                  deleteKey.run(type, id);
                  continue;
                }
                // LID mappings are disposable auxiliary cache data. Never
                // persist a scalar/undefined value that can later invalidate
                // the complete auth state during startup validation.
                if (type === 'lid-mapping' && !isObjectValue(value)) {
                  deleteKey.run(type, id);
                  continue;
                }
                const serialized = JSON.stringify(value, BufferJSON.replacer);
                if (serialized === undefined) {
                  if (type === 'lid-mapping') deleteKey.run(type, id);
                  else throw new Error(`AUTH_KEY_SERIALIZE_FAILED: ${type}/${id}`);
                  continue;
                }
                writeKey.run(type, id, serialized, Date.now());
              }
            }
          });
          transaction();
          if (typeof options.onMutation === 'function') options.onMutation('auth-keys');
        },
      },
    },
    saveCreds: () => writeCreds(creds),
  };
}

function clearSQLiteAuth(db, reason = 'cleared') {
  ensureAuthSchema(db);
  const clear = db.transaction(() => {
    db.prepare('DELETE FROM session_creds').run();
    db.prepare('DELETE FROM session_keys').run();
    setMeta(db, AUTH_META.status, 'invalid');
    setMeta(db, 'invalid_reason', reason);
    setMeta(db, AUTH_META.sourceKeyFiles, 0);
    setMeta(db, AUTH_META.databaseKeyRows, 0);
    setMeta(db, AUTH_META.sourceJsonFiles, 0);
    setMeta(db, AUTH_META.quarantinedPath, '');
    setMeta(db, AUTH_META.migratedAt, '');
    setMeta(db, AUTH_META.pendingFileMigration, '0');
    setMeta(db, 'invalid_reason', reason);
  });
  clear();
}

module.exports = {
  AUTH_META,
  ensureAuthSchema,
  getSQLiteAuthStats,
  hasVerifiedSQLiteAuth,
  validateSQLiteAuth,
  invalidateSQLiteAuth,
  migrateFilesToSQLite,
  finalizePendingFileMigration,
  cleanupSessionQuarantines,
  getSessionQuarantineStats,
  getSessionIdFingerprint,
  setSessionIdFingerprint,
  getSessionIdRevokedFingerprint,
  setSessionIdRevokedFingerprint,
  clearSQLiteAuth,
  useSQLiteAuthState,
};