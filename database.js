/**
 * SQLite-backed Database for June X Ultra
 * Drop-in replacement for the previous JSON-file implementation.
 * Uses better-sqlite3 (synchronous API) with sql.js WASM fallback.
 */

'use strict';

const path     = require('path');
const fs       = require('fs');
const { spawnSync } = require('child_process');
const crypto   = require('crypto');
const config   = require('./config');
const pgAdapter = require('./utils/juneDb/pgAdapter');
const mongoAdapter = require('./utils/juneDb/mongoAdapter');

const DB_DIR  = path.resolve(process.env.JUNE_DB_DIR || path.join(__dirname, 'database'));
const DB_FILE = path.resolve(process.env.JUNE_DB_FILE || path.join(DB_DIR, 'june-ultra.db'));
const DB_BACKUP_FILE = path.resolve(process.env.JUNE_DB_BACKUP_FILE || path.join(DB_DIR, 'june-ultra.db.backup'));
const DB_BACKUP_DEBOUNCE_MS = Number(process.env.JUNE_DB_BACKUP_DEBOUNCE_MS) || 15 * 1000;
const DB_BACKUP_INTERVAL_MS = Number(process.env.JUNE_DB_BACKUP_INTERVAL_MS) || 15 * 60 * 1000;
const DB_SCHEMA_VERSION = '4';
const NATIVE_PROBE_CACHE_FILE = path.join(DB_DIR, '.native-sqlite-probe.json');

function positiveNumberEnv(name, fallback, { minimum = 0 } = {}) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= minimum ? raw : fallback;
}

const DB_MAINTENANCE_INTERVAL_MS = positiveNumberEnv(
  'JUNE_DB_MAINTENANCE_INTERVAL_MS', 60 * 60 * 1000, { minimum: 60 * 1000 }
);
const ANTIDELETE_RETENTION_MS = positiveNumberEnv(
  'JUNE_ANTIDELETE_RETENTION_HOURS', 48, { minimum: 0 }
) * 60 * 60 * 1000;
const ANTIDELETE_STATUS_RETENTION_MS = positiveNumberEnv(
  'JUNE_ANTIDELETE_STATUS_RETENTION_HOURS', 24, { minimum: 0 }
) * 60 * 60 * 1000;
const ANTIDELETE_MAX_ROWS = Math.floor(positiveNumberEnv(
  'JUNE_ANTIDELETE_MAX_ROWS', 500, { minimum: 0 }
));
const ANTIDELETE_STATUS_MAX_ROWS = Math.floor(positiveNumberEnv(
  'JUNE_ANTIDELETE_STATUS_MAX_ROWS', 500, { minimum: 0 }
));
const REMOTE_SYNC_INTERVAL_MS = positiveNumberEnv(
  'JUNE_REMOTE_SYNC_INTERVAL_MS', 30 * 1000, { minimum: 5 * 1000 }
);
const REMOTE_SYNC_MAX_ROWS = Math.floor(positiveNumberEnv(
  'JUNE_REMOTE_SYNC_MAX_ROWS', 2000, { minimum: 100 }
));

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

// ── Determine which database driver to use ────────────────────────────────
// Native addons can crash the entire parent Node process with SIGSEGV when a
// copied node_modules directory does not match this Docker image / Node ABI.
// Probe better-sqlite3 in a disposable child process first. If it crashes,
// times out, or cannot load, the bot parent stays alive and selects sql.js.
const requestedSQLiteDriver = String(process.env.JUNE_SQLITE_DRIVER || 'auto').trim().toLowerCase();
const forceSqlJs = /^(1|true|yes|on)$/i.test(String(process.env.JUNE_FORCE_SQLJS || '')) ||
  ['wasm', 'sqljs', 'sql.js'].includes(requestedSQLiteDriver);
let dbDriver = 'unknown';
let Database = null;

function nativeProbeSignature() {
  let moduleStamp = 'unresolved';
  try {
    const resolved = require.resolve('better-sqlite3');
    const stats = fs.statSync(resolved);
    moduleStamp = `${resolved}:${stats.size}:${stats.mtimeMs}`;
  } catch (_) {}
  return JSON.stringify({
    node: process.version,
    abi: process.versions.modules || 'unknown',
    platform: process.platform,
    arch: process.arch,
    moduleStamp,
  });
}

function readFailedNativeProbe(signature) {
  try {
    const cached = JSON.parse(fs.readFileSync(NATIVE_PROBE_CACHE_FILE, 'utf8'));
    if (cached?.signature === signature && cached?.ok === false && cached?.reason) {
      return { ok: false, reason: `cached-${cached.reason}` };
    }
  } catch (_) {}
  return null;
}

function cacheFailedNativeProbe(signature, result) {
  try {
    const temporary = `${NATIVE_PROBE_CACHE_FILE}.tmp-${process.pid}`;
    fs.writeFileSync(temporary, JSON.stringify({
      signature,
      ok: false,
      reason: result.reason || 'probe-failed',
      checkedAt: Date.now(),
    }));
    fs.renameSync(temporary, NATIVE_PROBE_CACHE_FILE);
  } catch (_) {}
}

function clearFailedNativeProbeCache() {
  try { fs.rmSync(NATIVE_PROBE_CACHE_FILE, { force: true }); } catch (_) {}
}

function probeNativeBetterSqlite() {
  const probeProgram = [
    "'use strict';",
    "const Database = require('better-sqlite3');",
    "const db = new Database(':memory:');",
    "db.prepare('SELECT 1 AS ok').get();",
    "db.close();",
  ].join('');

  try {
    const result = spawnSync(process.execPath, ['-e', probeProgram], {
      cwd: __dirname,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 7000,
      windowsHide: true,
    });
    if (result.error) {
      return { ok: false, reason: result.error.code || 'spawn-error' };
    }
    if (result.status === 0 && !result.signal) return { ok: true, reason: 'passed' };
    return {
      ok: false,
      reason: result.signal
        ? `signal-${result.signal}`
        : `exit-${result.status ?? 'unknown'}`,
    };
  } catch (_) {
    return { ok: false, reason: 'probe-exception' };
  }
}

if (forceSqlJs) {
  dbDriver = 'sql.js-fallback';
  console.warn('[DB] sql.js selected by configuration');
} else {
  const signature = nativeProbeSignature();
  // A failed native binary is cached for this exact Node/ABI/module build so
  // a known SIGSEGV is not retried on every bot restart. Reinstalling the
  // module or changing Node changes the signature and automatically re-probes.
  const nativeProbe = requestedSQLiteDriver === 'native'
    ? probeNativeBetterSqlite()
    : (readFailedNativeProbe(signature) || probeNativeBetterSqlite());

  if (nativeProbe.ok) {
    clearFailedNativeProbeCache();
    try {
      Database = require('better-sqlite3');
      dbDriver = 'better-sqlite3';
      console.log(`[DB] Native SQLite probe passed (${process.version}/${process.platform}/${process.arch})`);
    } catch (_) {
      dbDriver = 'sql.js-fallback';
      console.warn('[DB] Native SQLite loaded in probe but failed in parent; using sql.js fallback');
    }
  } else {
    if (!String(nativeProbe.reason).startsWith('cached-')) {
      cacheFailedNativeProbe(signature, nativeProbe);
    }
    dbDriver = 'sql.js-fallback';
    console.warn(`[DB] Native SQLite probe failed (${nativeProbe.reason}); using sql.js fallback`);
  }
}

function cleanStaleBackupArtifacts() {
  try {
    const prefix = `${path.basename(DB_BACKUP_FILE)}.tmp-`;
    for (const name of fs.readdirSync(DB_DIR)) {
      if (name.startsWith(prefix)) {
        fs.rmSync(path.join(DB_DIR, name), { force: true });
      }
    }
  } catch (_) {}
}

cleanStaleBackupArtifacts();

let db;
let stmts = {};
let backupTimer = null;
let backupInterval = null;
let backupPromise = null;
let dirtyRevision = 0;
let backedUpRevision = -1;
let lastIntegrityCheck = null;
let lastBackup = null;
let lastMaintenance = null;
let maintenanceTimer = null;
let maintenanceRunning = false;
let remoteSyncTimer = null;
let remoteSyncRunning = false;
let lastRemoteSync = null;
let shuttingDown = false;

// SQLite is always the live source of truth. Remote adapters mirror writes in
// the background and never block a command when PostgreSQL/MongoDB is offline.
const REMOTE_IDENTITY_ARGUMENTS = {
  mirrorBotSetting: [0],
  mirrorGroupSettings: [0],
  mirrorGroupStat: [0, 1],
  mirrorUser: [0],
  mirrorWarning: [0, 1],
  mirrorModerator: [0],
  mirrorMutedUser: [0, 1],
  mirrorKV: [0, 1],
  deleteKV: [0, 1],
  mirrorAntideleteMessage: [0, 1],
  deleteAntideleteMessage: [0, 1],
  mirrorAntideleteStatus: [0],
  deleteAntideleteStatus: [0],
  mirrorLidMap: [0, 1],
  mirrorProfile: [0, 1],
};

function getRemoteAdapter(name) {
  return name === 'postgres' ? pgAdapter : name === 'mongo' ? mongoAdapter : null;
}

function remoteDedupeKey(adapter, method, args) {
  const indexes = REMOTE_IDENTITY_ARGUMENTS[method];
  const identity = indexes ? indexes.map((index) => args[index]) : args;
  const raw = JSON.stringify({ adapter, method, identity });
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function trimRemoteSyncQueue() {
  if (!db) return 0;
  try {
    const total = db.prepare('SELECT COUNT(*) AS count FROM remote_sync_queue').get().count;
    const excess = Math.max(0, total - REMOTE_SYNC_MAX_ROWS);
    if (!excess) return 0;
    const result = db.prepare(`
      DELETE FROM remote_sync_queue WHERE id IN (
        SELECT id FROM remote_sync_queue ORDER BY updated_at ASC LIMIT ?
      )
    `).run(excess);
    return result.changes || 0;
  } catch (_) {
    return 0;
  }
}

function enqueueRemoteSync(adapter, method, args, error = 'adapter-unavailable') {
  if (!db) return;
  try {
    const now = Date.now();
    const payload = JSON.stringify(args);
    const dedupeKey = remoteDedupeKey(adapter, method, args);
    db.prepare(`
      INSERT INTO remote_sync_queue
        (adapter, method, payload, dedupe_key, attempts, next_attempt_at, last_error, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)
      ON CONFLICT(dedupe_key) DO UPDATE SET
        payload = excluded.payload,
        attempts = 0,
        next_attempt_at = excluded.next_attempt_at,
        last_error = excluded.last_error,
        updated_at = excluded.updated_at
    `).run(adapter, method, payload, dedupeKey, now, String(error).slice(0, 500), now, now);
    trimRemoteSyncQueue();
    requestBackup('remote-sync-queued');
  } catch (_) {}
}

function invokeRemote(adapterName, adapter, method, args) {
  const status = adapter?.getStatus?.() || {};
  if (!status.configured) return;
  if (!status.available || typeof adapter?.[method] !== 'function') {
    enqueueRemoteSync(adapterName, method, args, 'adapter-unavailable');
    return;
  }

  Promise.resolve(adapter[method](...args))
    .then((result) => {
      if (result === null || result === false) {
        enqueueRemoteSync(adapterName, method, args, 'remote-operation-failed');
      }
    })
    .catch((error) => {
      enqueueRemoteSync(adapterName, method, args, error?.message || 'remote-operation-error');
    });
}

function mirrorRemote(method, ...args) {
  invokeRemote('postgres', pgAdapter, method, args);
  invokeRemote('mongo', mongoAdapter, method, args);
}

function deleteRemoteKV(namespace, key) {
  mirrorRemote('deleteKV', namespace, key);
}

function remoteRetryDelay(attempts) {
  return Math.min(5 * 60 * 1000, 5000 * (2 ** Math.min(6, attempts)));
}

async function processRemoteSyncQueue(reason = 'scheduled') {
  if (!db || remoteSyncRunning || shuttingDown) return lastRemoteSync;
  remoteSyncRunning = true;
  const summary = { reason, processed: 0, succeeded: 0, deferred: 0, failed: 0, timestamp: Date.now() };

  try {
    const rows = db.prepare(`
      SELECT id, adapter, method, payload, attempts
      FROM remote_sync_queue
      WHERE next_attempt_at <= ?
      ORDER BY id ASC
      LIMIT 50
    `).all(Date.now());

    const remove = db.prepare('DELETE FROM remote_sync_queue WHERE id = ?');
    const defer = db.prepare(`
      UPDATE remote_sync_queue
      SET attempts = ?, next_attempt_at = ?, last_error = ?, updated_at = ?
      WHERE id = ?
    `);

    for (const row of rows) {
      summary.processed += 1;
      const adapter = getRemoteAdapter(row.adapter);
      const status = adapter?.getStatus?.() || {};
      let args;
      try { args = JSON.parse(row.payload); } catch (_) { args = null; }

      if (!Array.isArray(args)) {
        remove.run(row.id);
        summary.failed += 1;
        continue;
      }

      if (!status.available || typeof adapter?.[row.method] !== 'function') {
        const attempts = Number(row.attempts || 0) + 1;
        defer.run(attempts, Date.now() + remoteRetryDelay(attempts), 'adapter-unavailable', Date.now(), row.id);
        summary.deferred += 1;
        continue;
      }

      try {
        const result = await adapter[row.method](...args);
        if (result === null || result === false) throw new Error('remote-operation-failed');
        remove.run(row.id);
        summary.succeeded += 1;
      } catch (error) {
        const attempts = Number(row.attempts || 0) + 1;
        defer.run(
          attempts,
          Date.now() + remoteRetryDelay(attempts),
          String(error?.message || error || 'remote-operation-failed').slice(0, 500),
          Date.now(),
          row.id
        );
        summary.deferred += 1;
      }
    }

    if (summary.succeeded > 0 || summary.failed > 0) requestBackup('remote-sync-processed');
    lastRemoteSync = summary;
    return summary;
  } finally {
    remoteSyncRunning = false;
  }
}

function getRemoteSyncQueueStats() {
  if (!db) return { pending: 0, due: 0, oldestAt: null, lastRun: lastRemoteSync };
  try {
    const now = Date.now();
    const row = db.prepare(`
      SELECT COUNT(*) AS pending,
        SUM(CASE WHEN next_attempt_at <= ? THEN 1 ELSE 0 END) AS due,
        MIN(created_at) AS oldest_at
      FROM remote_sync_queue
    `).get(now);
    return {
      pending: Number(row?.pending || 0),
      due: Number(row?.due || 0),
      oldestAt: row?.oldest_at || null,
      lastRun: lastRemoteSync,
    };
  } catch (_) {
    return { pending: 0, due: 0, oldestAt: null, lastRun: lastRemoteSync };
  }
}

function startRemoteSyncQueue() {
  if (remoteSyncTimer) clearInterval(remoteSyncTimer);
  remoteSyncTimer = setInterval(() => {
    void processRemoteSyncQueue('interval');
  }, REMOTE_SYNC_INTERVAL_MS);
  remoteSyncTimer.unref?.();
  const firstRun = setTimeout(() => void processRemoteSyncQueue('startup'), 5000);
  firstRun.unref?.();
}

function integrityCheck(connection) {
  try {
    if (dbDriver === 'better-sqlite3') {
      const result = connection.pragma('integrity_check', { simple: true });
      return { ok: result === 'ok', result };
    } else {
      return { ok: true, result: 'ok (sql.js)' };
    }
  } catch (error) {
    return { ok: false, result: error.message };
  }
}

function validateBackup(filePath = DB_BACKUP_FILE) {
  if (!fs.existsSync(filePath)) return false;
  try {
    return fs.statSync(filePath).size > 0;
  } catch (_) {
    return false;
  }
}

function removeBackupSidecars(filePath) {
  for (const sidecar of [`${filePath}-wal`, `${filePath}-shm`]) {
    try { fs.rmSync(sidecar, { force: true }); } catch (_) {}
  }
}

function restoreFromLocalBackup() {
  if (!validateBackup()) return false;
  removeBackupSidecars(DB_BACKUP_FILE);

  const suffix = `.corrupt-${Date.now()}-${process.pid}`;
  const moved = [];
  try {
    for (const filePath of [DB_FILE, `${DB_FILE}-wal`, `${DB_FILE}-shm`]) {
      if (!fs.existsSync(filePath)) continue;
      const quarantinePath = `${filePath}${suffix}`;
      fs.renameSync(filePath, quarantinePath);
      moved.push([filePath, quarantinePath]);
    }

    fs.copyFileSync(DB_BACKUP_FILE, DB_FILE);
    console.warn(`[DB] ✅ Restored from backup`);
    return true;
  } catch (error) {
    console.error(`[DB] ❌ Restore failed: ${error.message}`);
    try { fs.rmSync(DB_FILE, { force: true }); } catch (_) {}
    for (const [originalPath, quarantinePath] of moved.reverse()) {
      try {
        if (fs.existsSync(quarantinePath)) fs.renameSync(quarantinePath, originalPath);
      } catch (_) {}
    }
    return false;
  }
}

function configureDatabase(connection) {
  if (dbDriver === 'better-sqlite3') {
    try {
      connection.pragma('journal_mode = WAL');
      connection.pragma('synchronous  = NORMAL');
      connection.pragma('cache_size   = -16000');
      connection.pragma('foreign_keys = ON');
    } catch (_) {}
  }
}

// ── sql.js Wrapper Class ──────────────────────────────────────────────────
class SqlJsDatabase {
  constructor(sqlDatabase, filePath) {
    this.sqlDb = sqlDatabase;
    this.filePath = filePath;
    this._transactionDepth = 0;
  }

  prepare(sql) {
    return new SqlJsStatement(this.sqlDb, sql, this);
  }

  exec(sql) {
    try {
      // sql.js can execute a complete multi-statement script. Splitting on
      // semicolons breaks when a semicolon appears inside a string/comment.
      this.sqlDb.exec(sql);
      this._save();
    } catch (err) {
      console.error('[DB] sql.js query failed:', err.message);
      throw err;
    }
  }

  pragma(pragma, options = {}) {
    if (options.simple) return 'ok';
    return [];
  }

  transaction(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('[DB] transaction callback must be a function');
    }

    // better-sqlite3 returns a callable transaction wrapper; callers create
    // it first and invoke it later (for example: db.transaction(fn)()).
    // Match that API instead of executing the callback while constructing it.
    return (...args) => {
      // Support nested callers without issuing nested BEGIN statements.
      if (this._transactionDepth > 0) {
        return callback(...args);
      }

      this.sqlDb.exec('BEGIN');
      this._transactionDepth = 1;

      try {
        const result = callback(...args);
        this.sqlDb.exec('COMMIT');
        this._transactionDepth = 0;
        this._save();
        return result;
      } catch (error) {
        this._transactionDepth = 0;
        try {
          this.sqlDb.exec('ROLLBACK');
        } catch (_) {}
        throw error;
      }
    };
  }

  backup(targetPath) {
    return new Promise((resolve, reject) => {
      try {
        const data = this.sqlDb.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(targetPath, buffer);
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  }

  close() {
    try {
      this._save();
      this.sqlDb.close?.();
    } catch (_) {}
  }

  _save() {
    if (this._transactionDepth > 0) return;

    const data = this.sqlDb.export();
    const buffer = Buffer.from(data);
    const temporaryFile = `${this.filePath}.tmp-${process.pid}`;
    fs.writeFileSync(temporaryFile, buffer);
    fs.renameSync(temporaryFile, this.filePath);
  }
}

class SqlJsStatement {
  constructor(sqlDb, sql, wrapper) {
    this.sqlDb = sqlDb;
    this.sql = sql;
    this.wrapper = wrapper;
  }

  run(...params) {
    try {
      const stmt = this.sqlDb.prepare(this.sql);
      stmt.bind(params);
      stmt.step();
      stmt.free();
      this.wrapper._save();
      return { changes: this.sqlDb.getRowsModified?.() || 1 };
    } catch (err) {
      console.error('[DB-sql.js] run error:', err.message);
      throw err;
    }
  }

  get(...params) {
    try {
      const stmt = this.sqlDb.prepare(this.sql);
      stmt.bind(params);
      const result = stmt.step() ? stmt.getAsObject() : null;
      stmt.free();
      return result;
    } catch (err) {
      console.error('[DB-sql.js] get error:', err.message);
      return null;
    }
  }

  all(...params) {
    try {
      const stmt = this.sqlDb.prepare(this.sql);
      stmt.bind(params);
      const results = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
      stmt.free();
      return results;
    } catch (err) {
      console.error('[DB-sql.js] all error:', err.message);
      return [];
    }
  }
}

async function openDatabase() {
  // A missing or empty primary is recoverable before opening a new SQLite file.
  if ((!fs.existsSync(DB_FILE) || fs.statSync(DB_FILE).size === 0) && validateBackup()) {
    restoreFromLocalBackup();
  }

  let connection;

  if (dbDriver === 'better-sqlite3') {
    try {
      connection = new Database(DB_FILE);
      console.log('[DB] Using better-sqlite3 native');
    } catch (error) {
      // Do not print the native error: on incompatible VPS images it contains
      // a very noisy GLIBC/native-loader stack. Fall back cleanly instead.
      console.warn('[DB] Native SQLite unavailable on this VPS');
      console.warn('[DB] Falling back to sql.js WASM');
      dbDriver = 'sql.js-fallback';
      return openDatabase();
    }

    const initialIntegrity = integrityCheck(connection);
    if (!initialIntegrity.ok) {
      try { connection.close(); } catch (_) {}
      if (!restoreFromLocalBackup()) {
        throw new Error(`Integrity check failed: ${initialIntegrity.result}`);
      }
      connection = new Database(DB_FILE);
      const restoredIntegrity = integrityCheck(connection);
      if (!restoredIntegrity.ok) {
        try { connection.close(); } catch (_) {}
        throw new Error(`Backup also failed integrity check`);
      }
    }

    configureDatabase(connection);
    lastIntegrityCheck = { ok: true, result: 'ok', checkedAt: Date.now() };
    console.log('[DB] ✅ Integrity check passed');
    return connection;

  } else if (dbDriver === 'sql.js-fallback') {
    console.log('[DB] Loading sql.js WASM...');

    try {
      const sqlJsModule = require('sql.js');
      const initSqlJs = typeof sqlJsModule === 'function'
        ? sqlJsModule
        : sqlJsModule.default;

      if (typeof initSqlJs !== 'function') {
        throw new Error('sql.js initialization function was not found');
      }

      // sql.js exports an async initializer, not the Database constructor.
      const SQL = await initSqlJs({
        locateFile: (file) => path.join(
          path.dirname(require.resolve('sql.js')),
          file
        )
      });

      let dbData = null;
      if (fs.existsSync(DB_FILE)) {
        dbData = fs.readFileSync(DB_FILE);
      }

      const sqlDatabase = new SQL.Database(dbData);
      connection = new SqlJsDatabase(sqlDatabase, DB_FILE);

      configureDatabase(connection);
      lastIntegrityCheck = { ok: true, result: 'ok', checkedAt: Date.now() };
      console.log('[DB] Using sql.js WASM fallback');
      return connection;

    } catch (error) {
      console.error(`[DB] sql.js fallback failed: ${error.message}`);
      throw new Error(`sql.js fallback could not start: ${error.message}`);
    }
  }

  throw new Error('No database driver available');
}

// ── Schema ────────────────────────────────────────────────────────────────────
const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS database_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  INSERT INTO database_meta (key, value) VALUES ('schema_version', '${DB_SCHEMA_VERSION}')
    ON CONFLICT(key) DO UPDATE SET value = excluded.value;

  CREATE TABLE IF NOT EXISTS groups (
    group_id TEXT PRIMARY KEY,
    settings TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    data    TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS warnings (
    group_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    count    INTEGER NOT NULL DEFAULT 0,
    entries  TEXT    NOT NULL DEFAULT '[]',
    PRIMARY KEY (group_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS moderators (
    user_id TEXT PRIMARY KEY
  );

  CREATE TABLE IF NOT EXISTS muted_users (
    group_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    PRIMARY KEY (group_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS bot_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS session (
    id       INTEGER PRIMARY KEY DEFAULT 1,
    creds    TEXT,
    saved_at INTEGER
  );

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

  CREATE TABLE IF NOT EXISTS group_stats (
    group_id TEXT NOT NULL,
    date     TEXT NOT NULL,
    data     TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (group_id, date)
  );

  CREATE TABLE IF NOT EXISTS chat_profiles (
    bot_id  TEXT NOT NULL,
    user_id TEXT NOT NULL,
    profile TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (bot_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS kv_store (
    namespace TEXT NOT NULL,
    key       TEXT NOT NULL,
    value     TEXT NOT NULL,
    PRIMARY KEY (namespace, key)
  );

  CREATE TABLE IF NOT EXISTS antidelete_messages (
    chat_id   TEXT NOT NULL,
    message_id TEXT NOT NULL,
    payload   TEXT NOT NULL DEFAULT '{}',
    stored_at INTEGER NOT NULL,
    PRIMARY KEY (chat_id, message_id)
  );

  CREATE TABLE IF NOT EXISTS antidelete_statuses (
    status_id TEXT PRIMARY KEY,
    payload   TEXT NOT NULL DEFAULT '{}',
    stored_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_antidelete_messages_stored_at ON antidelete_messages(stored_at);
  CREATE INDEX IF NOT EXISTS idx_antidelete_statuses_stored_at ON antidelete_statuses(stored_at);

  CREATE TABLE IF NOT EXISTS remote_sync_queue (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    adapter         TEXT NOT NULL,
    method          TEXT NOT NULL,
    payload         TEXT NOT NULL,
    dedupe_key      TEXT NOT NULL UNIQUE,
    attempts        INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL,
    last_error      TEXT,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_remote_sync_queue_due ON remote_sync_queue(next_attempt_at);

  CREATE TABLE IF NOT EXISTS lid_map (
    direction TEXT NOT NULL,
    user      TEXT NOT NULL,
    value     TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (direction, user)
  );

  CREATE TABLE IF NOT EXISTS runtime_telemetry (
    event_type TEXT NOT NULL,
    event_key  TEXT NOT NULL,
    payload    TEXT NOT NULL DEFAULT '{}',
    count      INTEGER NOT NULL DEFAULT 1,
    first_seen INTEGER NOT NULL,
    last_seen  INTEGER NOT NULL,
    PRIMARY KEY (event_type, event_key)
  );
`;

// ── Prepared Statements ────────────────────────────────────────────────────
function createPreparedStatements() {
  return {
    getGroupSettings: db.prepare('SELECT settings FROM groups WHERE group_id = ?'),
    upsertGroupSettings: db.prepare('INSERT INTO groups (group_id, settings) VALUES (?, ?) ON CONFLICT(group_id) DO UPDATE SET settings = excluded.settings'),
    getUser: db.prepare('SELECT data FROM users WHERE user_id = ?'),
    upsertUser: db.prepare('INSERT INTO users (user_id, data) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data'),
    getWarnings: db.prepare('SELECT count, entries FROM warnings WHERE group_id = ? AND user_id = ?'),
    getWarningsForGroup: db.prepare('SELECT user_id, count, entries FROM warnings WHERE group_id = ?'),
    upsertWarning: db.prepare('INSERT INTO warnings (group_id, user_id, count, entries) VALUES (?, ?, ?, ?) ON CONFLICT(group_id, user_id) DO UPDATE SET count = excluded.count, entries = excluded.entries'),
    deleteWarning: db.prepare('DELETE FROM warnings WHERE group_id = ? AND user_id = ?'),
    clearWarnings: db.prepare('DELETE FROM warnings WHERE group_id = ?'),
    getModerators: db.prepare('SELECT user_id FROM moderators'),
    addModerator: db.prepare('INSERT OR IGNORE INTO moderators (user_id) VALUES (?)'),
    removeModerator: db.prepare('DELETE FROM moderators WHERE user_id = ?'),
    isModerator: db.prepare('SELECT 1 FROM moderators WHERE user_id = ? LIMIT 1'),
    muteUser: db.prepare('INSERT OR IGNORE INTO muted_users (group_id, user_id) VALUES (?, ?)'),
    unmuteUser: db.prepare('DELETE FROM muted_users WHERE group_id = ? AND user_id = ?'),
    isUserMuted: db.prepare('SELECT 1 FROM muted_users WHERE group_id = ? AND user_id = ? LIMIT 1'),
    getMutedUsers: db.prepare('SELECT user_id FROM muted_users WHERE group_id = ?'),
    getBotSetting: db.prepare('SELECT value FROM bot_settings WHERE key = ?'),
    setBotSetting: db.prepare('INSERT INTO bot_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
    getAllBotSettings: db.prepare('SELECT key, value FROM bot_settings'),
    getSession: db.prepare('SELECT creds FROM session WHERE id = 1'),
    upsertSession: db.prepare('INSERT INTO session (id, creds, saved_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET creds = excluded.creds, saved_at = excluded.saved_at'),
    clearSession: db.prepare('DELETE FROM session WHERE id = 1'),
    getKV: db.prepare('SELECT value FROM kv_store WHERE namespace = ? AND key = ?'),
    setKV: db.prepare('INSERT INTO kv_store (namespace, key, value) VALUES (?, ?, ?) ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value'),
    delKV: db.prepare('DELETE FROM kv_store WHERE namespace = ? AND key = ?'),
    allKV: db.prepare('SELECT key, value FROM kv_store WHERE namespace = ?'),
    insertGroupStat: db.prepare('INSERT INTO group_stats (group_id, date, data) VALUES (?, ?, ?) ON CONFLICT(group_id, date) DO UPDATE SET data = excluded.data'),
    getGroupStat: db.prepare('SELECT data FROM group_stats WHERE group_id = ? AND date = ?'),
    getAllGroupStats: db.prepare('SELECT date, data FROM group_stats WHERE group_id = ?'),
    saveAntideleteMessage: db.prepare('INSERT INTO antidelete_messages (chat_id, message_id, payload, stored_at) VALUES (?, ?, ?, ?) ON CONFLICT(chat_id, message_id) DO UPDATE SET payload = excluded.payload, stored_at = excluded.stored_at'),
    getAntideleteMessages: db.prepare('SELECT chat_id, message_id, payload, stored_at FROM antidelete_messages ORDER BY stored_at ASC'),
    deleteAntideleteMessage: db.prepare('DELETE FROM antidelete_messages WHERE chat_id = ? AND message_id = ?'),
    saveAntideleteStatus: db.prepare('INSERT INTO antidelete_statuses (status_id, payload, stored_at) VALUES (?, ?, ?) ON CONFLICT(status_id) DO UPDATE SET payload = excluded.payload, stored_at = excluded.stored_at'),
    getAntideleteStatuses: db.prepare('SELECT status_id, payload, stored_at FROM antidelete_statuses ORDER BY stored_at ASC'),
    deleteAntideleteStatus: db.prepare('DELETE FROM antidelete_statuses WHERE status_id = ?'),
    saveLidMap: db.prepare('INSERT INTO lid_map (direction, user, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(direction, user) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'),
    getLidMap: db.prepare('SELECT value FROM lid_map WHERE direction = ? AND user = ?'),
    getLidMaps: db.prepare('SELECT direction, user, value, updated_at FROM lid_map'),
    getRuntimeTelemetry: db.prepare('SELECT event_type, event_key, payload, count, first_seen, last_seen FROM runtime_telemetry ORDER BY last_seen DESC LIMIT ?'),
    getRuntimeTelemetryEntry: db.prepare('SELECT event_type, event_key, payload, count, first_seen, last_seen FROM runtime_telemetry WHERE event_type = ? AND event_key = ?'),
    upsertRuntimeTelemetry: db.prepare(`
      INSERT INTO runtime_telemetry
        (event_type, event_key, payload, count, first_seen, last_seen)
      VALUES (?, ?, ?, 1, ?, ?)
      ON CONFLICT(event_type, event_key) DO UPDATE SET
        payload = excluded.payload,
        count = runtime_telemetry.count + 1,
        last_seen = excluded.last_seen
    `),
    getProfile: db.prepare('SELECT profile FROM chat_profiles WHERE bot_id = ? AND user_id = ?'),
    saveProfile: db.prepare('INSERT INTO chat_profiles (bot_id, user_id, profile) VALUES (?, ?, ?) ON CONFLICT(bot_id, user_id) DO UPDATE SET profile = excluded.profile'),
  };
}

async function initializeDatabase() {
  db = await openDatabase();
  db.exec(SCHEMA_SQL);
  stmts = createPreparedStatements();

  backupInterval = setInterval(() => {
    if (!shuttingDown && dirtyRevision > backedUpRevision) {
      void createAtomicBackup('interval');
    }
  }, DB_BACKUP_INTERVAL_MS);
  backupInterval.unref?.();
  startDatabaseMaintenance();
  startRemoteSyncQueue();

  return db;
}

// Await this before using any database method.
const ready = initializeDatabase().catch((error) => {
  console.error(`[DB] Startup failed: ${error.message}`);
  throw error;
});

function requestBackup(_reason = 'write') {
  dirtyRevision++;
  if (backupTimer || shuttingDown) return;
  backupTimer = setTimeout(() => {
    backupTimer = null;
    if (dirtyRevision > backedUpRevision) void createAtomicBackup('write');
  }, DB_BACKUP_DEBOUNCE_MS);
  backupTimer.unref?.();
}

async function createAtomicBackup(reason = 'scheduled') {
  if (backupPromise) return backupPromise;
  const revisionAtStart = dirtyRevision;
  const tempPath = `${DB_BACKUP_FILE}.tmp-${process.pid}-${Date.now()}`;
  backupPromise = (async () => {
    try {
      await db.backup(tempPath);
      const tempStats = fs.statSync(tempPath);
      if (tempStats.size === 0) {
        fs.rmSync(tempPath, { force: true });
        throw new Error('Backup empty');
      }
      removeBackupSidecars(DB_BACKUP_FILE);
      fs.renameSync(tempPath, DB_BACKUP_FILE);
      backedUpRevision = revisionAtStart;
      lastBackup = { ok: true, size: tempStats.size, reason, timestamp: Date.now() };
      // Backup status is available through getDatabaseHealth()/health details.
      // Do not print every successful debounce backup to the live bot console.
    } catch (error) {
      console.warn(`[DB] ⚠️  Backup failed:`, error.message);
      try { fs.rmSync(tempPath, { force: true }); } catch (_) {}
      lastBackup = { ok: false, error: error.message, timestamp: Date.now() };
    } finally {
      backupPromise = null;
    }
  })();
  return backupPromise;
}

async function flushBackup() {
  clearTimeout(backupTimer);
  clearInterval(backupInterval);
  clearInterval(maintenanceTimer);
  clearInterval(remoteSyncTimer);
  if (dirtyRevision > backedUpRevision) {
    await createAtomicBackup('shutdown');
  }
}

// ── Database maintenance ──────────────────────────────────────────────────
function listAntideleteRowsForCleanup(table, idColumns, cutoff, maximumRows) {
  const rows = [];
  if (cutoff !== null) {
    const whereRows = db.prepare(
      `SELECT ${idColumns.join(', ')} FROM ${table} WHERE stored_at < ? ORDER BY stored_at ASC`
    ).all(cutoff);
    rows.push(...whereRows);
  }

  if (maximumRows > 0) {
    const count = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
    const excess = Math.max(0, count - maximumRows);
    if (excess > 0) {
      const oldest = db.prepare(
        `SELECT ${idColumns.join(', ')} FROM ${table} ORDER BY stored_at ASC LIMIT ?`
      ).all(excess);
      rows.push(...oldest);
    }
  }

  const seen = new Set();
  return rows.filter((row) => {
    const key = idColumns.map((column) => row[column]).join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function pruneAntideleteData() {
  if (!db) return { messages: 0, statuses: 0 };
  const now = Date.now();
  const messageCutoff = ANTIDELETE_RETENTION_MS > 0 ? now - ANTIDELETE_RETENTION_MS : null;
  const statusCutoff = ANTIDELETE_STATUS_RETENTION_MS > 0 ? now - ANTIDELETE_STATUS_RETENTION_MS : null;
  const messages = listAntideleteRowsForCleanup(
    'antidelete_messages', ['chat_id', 'message_id'], messageCutoff, ANTIDELETE_MAX_ROWS
  );
  const statuses = listAntideleteRowsForCleanup(
    'antidelete_statuses', ['status_id'], statusCutoff, ANTIDELETE_STATUS_MAX_ROWS
  );

  const deleteMessage = db.prepare(
    'DELETE FROM antidelete_messages WHERE chat_id = ? AND message_id = ?'
  );
  const deleteStatus = db.prepare('DELETE FROM antidelete_statuses WHERE status_id = ?');
  const prune = db.transaction(() => {
    for (const row of messages) deleteMessage.run(row.chat_id, row.message_id);
    for (const row of statuses) deleteStatus.run(row.status_id);
  });
  prune();

  // Keep remote mirrors tidy too. These calls are non-blocking and are routed
  // through the durable mirror queue when a configured adapter is unavailable.
  for (const row of messages) mirrorRemote('deleteAntideleteMessage', row.chat_id, row.message_id);
  for (const row of statuses) mirrorRemote('deleteAntideleteStatus', row.status_id);

  return { messages: messages.length, statuses: statuses.length };
}

async function runDatabaseMaintenance(reason = 'scheduled') {
  if (!db || maintenanceRunning || shuttingDown) return lastMaintenance;
  maintenanceRunning = true;
  try {
    const pruned = pruneAntideleteData();
    const remoteSync = await processRemoteSyncQueue('maintenance');
    let checkpointed = false;
    if (dbDriver === 'better-sqlite3') {
      try {
        db.pragma('wal_checkpoint(PASSIVE)');
        checkpointed = true;
      } catch (_) {}
    }
    const removed = pruned.messages + pruned.statuses;
    if (removed > 0) requestBackup('database-maintenance');
    lastMaintenance = {
      ok: true,
      reason,
      timestamp: Date.now(),
      removedMessages: pruned.messages,
      removedStatuses: pruned.statuses,
      checkpointed,
      remoteSync,
    };
    if (removed > 0) {
      console.log(`[DB] Maintenance removed ${removed} expired/excess antidelete record(s).`);
    }
    return lastMaintenance;
  } catch (error) {
    lastMaintenance = { ok: false, reason, error: error.message, timestamp: Date.now() };
    console.warn(`[DB] Maintenance failed: ${error.message}`);
    return lastMaintenance;
  } finally {
    maintenanceRunning = false;
  }
}

function startDatabaseMaintenance() {
  if (maintenanceTimer) clearInterval(maintenanceTimer);
  maintenanceTimer = setInterval(() => {
    void runDatabaseMaintenance('interval');
  }, DB_MAINTENANCE_INTERVAL_MS);
  maintenanceTimer.unref?.();
  const firstRun = setTimeout(() => void runDatabaseMaintenance('startup'), 60 * 1000);
  firstRun.unref?.();
}

function vacuumDatabase() {
  if (!db || dbDriver !== 'better-sqlite3') {
    return { ok: false, skipped: true, reason: 'native-sqlite-not-active' };
  }
  try {
    db.exec('VACUUM');
    return { ok: true, timestamp: Date.now() };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

// ── Helper Functions ──────────────────────────────────────────────────────
function parse(value, fallback = null) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function serial(value) {
  return JSON.stringify(value);
}

// ── Group Settings ────────────────────────────────────────────────────────
const BOT_SETTINGS_DEFAULTS = {
  botName: 'June-X Ultra',
  prefix: '.',
  autoRead: true,
  autoReact: false,
  mode: 'public',
};

const getGroupSettings = (groupId) => {
  const row = stmts.getGroupSettings.get(groupId);
  return row ? parse(row.settings, {}) : {};
};

const updateGroupSettings = (groupId, settings) => {
  stmts.upsertGroupSettings.run(groupId, serial(settings));
  requestBackup('group-settings');
  mirrorRemote('mirrorGroupSettings', groupId, settings);
};

// ── Users ─────────────────────────────────────────────────────────────────
const getUser = (userId) => {
  const row = stmts.getUser.get(userId);
  return row ? parse(row.data, {}) : {};
};

const updateUser = (userId, data) => {
  stmts.upsertUser.run(userId, serial(data));
  requestBackup('user-update');
  mirrorRemote('mirrorUser', userId, data);
};

// ── Warnings ──────────────────────────────────────────────────────────────
const getWarnings = (groupId, userId) => {
  const row = stmts.getWarnings.get(groupId, userId);
  if (!row) return { count: 0, entries: [] };
  return { count: row.count, entries: parse(row.entries, []) };
};

const addWarning = (groupId, userId, reason = '') => {
  const current = getWarnings(groupId, userId);
  const entries = [...(current.entries || []), { reason, timestamp: Date.now() }];
  stmts.upsertWarning.run(groupId, userId, current.count + 1, serial(entries));
  requestBackup('warning-add');
  mirrorRemote('mirrorWarning', groupId, userId, {
    count: current.count + 1,
    entries,
  });
  return current.count + 1;
};

const removeWarning = (groupId, userId) => {
  const current = getWarnings(groupId, userId);
  if (current.count <= 0) return 0;
  stmts.upsertWarning.run(groupId, userId, current.count - 1, serial(current.entries));
  requestBackup('warning-remove');
  mirrorRemote('mirrorWarning', groupId, userId, {
    count: current.count - 1,
    entries: current.entries,
  });
  return current.count - 1;
};

const clearWarnings = (groupId, userId) => {
  if (userId) {
    stmts.deleteWarning.run(groupId, userId);
    mirrorRemote('mirrorWarning', groupId, userId, { count: 0, entries: [] });
  } else {
    const currentRows = stmts.getWarningsForGroup.all(groupId);
    stmts.clearWarnings.run(groupId);
    for (const row of currentRows) {
      mirrorRemote('mirrorWarning', groupId, row.user_id, { count: 0, entries: [] });
    }
  }
  requestBackup('warning-clear');
  return true;
};

// ── Moderators ────────────────────────────────────────────────────────────
const getModerators = () => stmts.getModerators.all().map(row => row.user_id);
const addModerator = (userId) => { stmts.addModerator.run(userId); requestBackup('moderator-add'); mirrorRemote('mirrorModerator', userId, true); return true; };
const removeModerator = (userId) => { stmts.removeModerator.run(userId); requestBackup('moderator-remove'); mirrorRemote('mirrorModerator', userId, false); return true; };
const isModerator = (userId) => !!stmts.isModerator.get(userId);

// ── Muted Users ───────────────────────────────────────────────────────────
const muteUser = (groupId, userId) => { stmts.muteUser.run(groupId, userId); requestBackup('mute-user'); mirrorRemote('mirrorMutedUser', groupId, userId, true); return true; };
const unmuteUser = (groupId, userId) => { stmts.unmuteUser.run(groupId, userId); requestBackup('unmute-user'); mirrorRemote('mirrorMutedUser', groupId, userId, false); return true; };
const isUserMuted = (groupId, userId) => !!stmts.isUserMuted.get(groupId, userId);
const getMutedUsers = (groupId) => stmts.getMutedUsers.all(groupId).map(row => row.user_id);

// ── Bot Settings ──────────────────────────────────────────────────────────
const getBotSetting = (key) => { const row = stmts.getBotSetting.get(key); return row ? parse(row.value) : BOT_SETTINGS_DEFAULTS[key]; };
const setBotSetting = (key, value) => { stmts.setBotSetting.run(key, serial(value)); requestBackup('bot-setting'); mirrorRemote('mirrorBotSetting', key, value); return true; };
const getStoredBotSettings = () => {
  const result = {};
  for (const row of stmts.getAllBotSettings.all()) result[row.key] = parse(row.value);
  return result;
};
const getAllBotSettings = () => ({ ...BOT_SETTINGS_DEFAULTS, ...getStoredBotSettings() });
const updateBotSettings = (updates) => { for (const [key, value] of Object.entries(updates)) setBotSetting(key, value); return true; };
const VALID_BOT_MODES = ['public', 'groups', 'dms', 'silent'];
const getBotMode = () => {
  const mode = getBotSetting('mode') || 'public';
  if (mode === 'private' || mode === 'restricted') return 'silent';
  if (mode === 'group') return 'groups';
  if (mode === 'pm') return 'dms';
  return VALID_BOT_MODES.includes(mode) ? mode : 'public';
};
const setBotMode = (mode) => {
  const normalized = {
    private: 'silent',
    restricted: 'silent',
    group: 'groups',
    pm: 'dms',
  }[mode] || mode;
  if (!VALID_BOT_MODES.includes(normalized)) throw new Error(`Invalid mode: ${mode}`);
  setBotSetting('mode', normalized);
  return true;
};

// ── Antiforward ───────────────────────────────────────────────────────────
const getAntiforwardSettings = (groupId) => {
  const settings = getGroupSettings(groupId);
  return { enabled: settings.antiforward || false, warnLimit: settings.antiforwardLimit || 3 };
};
const updateAntiforwardSettings = (groupId, enabled, warnLimit) => {
  const settings = getGroupSettings(groupId);
  settings.antiforward = !!enabled;
  settings.antiforwardLimit = Number(warnLimit) || 3;
  updateGroupSettings(groupId, settings);
  requestBackup('antiforward-settings');
};
const addAntiforwardWarning = (groupId, userId) => addWarning(groupId, userId, 'antiforward');
const getAntiforwardWarningCount = (groupId, userId) => getWarnings(groupId, userId).count;
const clearAntiforwardWarning = (groupId, userId) => removeWarning(groupId, userId);
const clearAllAntiforwardWarnings = (groupId) => clearWarnings(groupId);

// ── Session ───────────────────────────────────────────────────────────────
const saveSession = (credsPath) => {
  try {
    if (!fs.existsSync(credsPath)) return false;
    const creds = fs.readFileSync(credsPath).toString('base64');
    stmts.upsertSession.run(creds, Date.now());
    requestBackup('session');
    return true;
  } catch (e) {
    console.error('[SESSION-DB]:', e.message);
    return false;
  }
};
const getSession = () => {
  try {
    const row = stmts.getSession.get();
    return row ? row.creds : null;
  } catch (e) {
    console.error('[SESSION-DB]:', e.message);
    return null;
  }
};
const clearSession = () => { stmts.clearSession.run(); requestBackup('session-clear'); return true; };

// ── Status Settings helpers ───────────────────────────────────────────────
function loadSettings() {
  return {
    enabled:     getBotSetting('autoStatusView')        || false,
    react:       getBotSetting('autoStatusReact')       || false,
    emoji:       getBotSetting('autoStatusEmoji')       || '💙',
    emojiPool:   getBotSetting('autoStatusEmojiPool')   || [],
    randomEmoji: getBotSetting('autoStatusRandomEmoji') || false,
  };
}
function saveSettings(settings) {
  updateBotSettings({
    autoStatusView:        !!settings.enabled,
    autoStatusReact:       !!settings.react,
    autoStatusEmoji:       settings.emoji      || '',
    autoStatusEmojiPool:   settings.emojiPool  || [],
    autoStatusRandomEmoji: !!settings.randomEmoji,
  });
}
function cleanEmoji(str) { return str.replace(/[\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}\u200D\u200B\uFEFF]/gu, '').trim(); }
function pickEmoji(settings) { return (settings.randomEmoji && settings.emojiPool.length) ? settings.emojiPool[Math.floor(Math.random() * settings.emojiPool.length)] : settings.emoji; }

// ── KV Store ──────────────────────────────────────────────────────────────
const getKV = (namespace, key, fallback = null) => { const row = stmts.getKV.get(namespace, key); if (!row) return fallback; return parse(row.value, fallback); };
const setKV = (namespace, key, value) => { stmts.setKV.run(namespace, key, serial(value)); requestBackup('kv'); mirrorRemote('mirrorKV', namespace, key, value); return true; };
const delKV = (namespace, key) => { stmts.delKV.run(namespace, key); requestBackup('kv-delete'); deleteRemoteKV(namespace, key); return true; };
const getAllKV = (namespace) => { const rows = stmts.allKV.all(namespace); const out = {}; for (const { key, value } of rows) out[key] = parse(value); return out; };

// ── Group statistics ─────────────────────────────────────────────────────
const getGroupStat = (groupId, date) => {
  const row = stmts.getGroupStat.get(String(groupId), String(date));
  return row ? parse(row.data, {}) : null;
};
const saveGroupStat = (groupId, date, data) => {
  stmts.insertGroupStat.run(String(groupId), String(date), serial(data || {}));
  requestBackup('group-stat');
  mirrorRemote('mirrorGroupStat', groupId, date, data);
  return true;
};
const getAllGroupStats = (groupId) => stmts.getAllGroupStats.all(String(groupId))
  .map(row => ({ date: row.date, data: parse(row.data, {}) }));

const saveAntideleteMessage = (chatId, messageId, payload, storedAt = Date.now()) => {
  stmts.saveAntideleteMessage.run(String(chatId), String(messageId), serial(payload || {}), Number(storedAt));
  requestBackup('antidelete-message');
  mirrorRemote('mirrorAntideleteMessage', chatId, messageId, payload, storedAt);
  return true;
};
const getAntideleteMessages = () => stmts.getAntideleteMessages.all()
  .map(row => ({ chatId: row.chat_id, messageId: row.message_id, payload: parse(row.payload, {}), storedAt: row.stored_at }));
const deleteAntideleteMessage = (chatId, messageId) => {
  stmts.deleteAntideleteMessage.run(String(chatId), String(messageId));
  mirrorRemote('deleteAntideleteMessage', chatId, messageId);
  return true;
};
const saveAntideleteStatus = (statusId, payload, storedAt = Date.now()) => {
  stmts.saveAntideleteStatus.run(String(statusId), serial(payload || {}), Number(storedAt));
  requestBackup('antidelete-status');
  mirrorRemote('mirrorAntideleteStatus', statusId, payload, storedAt);
  return true;
};
const getAntideleteStatuses = () => stmts.getAntideleteStatuses.all()
  .map(row => ({ statusId: row.status_id, payload: parse(row.payload, {}), storedAt: row.stored_at }));
const deleteAntideleteStatus = (statusId) => {
  stmts.deleteAntideleteStatus.run(String(statusId));
  mirrorRemote('deleteAntideleteStatus', statusId);
  return true;
};
const saveLidMap = (direction, user, value, updatedAt = Date.now()) => {
  stmts.saveLidMap.run(String(direction), String(user), String(value), Number(updatedAt));
  mirrorRemote('mirrorLidMap', direction, user, value, updatedAt);
  return true;
};
const getLidMaps = () => stmts.getLidMaps.all();
const getLidMap = (direction, user) => {
  const row = stmts.getLidMap.get(String(direction), String(user));
  return row?.value || null;
};

const recordRuntimeTelemetry = (eventType, eventKey, payload = {}, timestamp = Date.now()) => {
  const type = String(eventType || 'unknown').slice(0, 80);
  const key = String(eventKey || 'unknown').slice(0, 240);
  const now = Number(timestamp) || Date.now();
  const serializedPayload = serial(payload || {});
  stmts.upsertRuntimeTelemetry.run(type, key, serializedPayload, now, now);
  const summary = stmts.getRuntimeTelemetryEntry.get(type, key);
  mirrorRemote('mirrorKV', 'runtime_telemetry', `${type}:${key}`, {
    eventType: type,
    eventKey: key,
    payload: payload || {},
    count: summary?.count || 1,
    firstSeen: summary?.first_seen || now,
    lastSeen: summary?.last_seen || now,
  });
  requestBackup('runtime-telemetry');
  return true;
};

const getRuntimeTelemetry = (limit = 100) => stmts.getRuntimeTelemetry
  .all(Math.max(1, Math.min(1000, Number(limit) || 100)))
  .map(row => ({
    eventType: row.event_type,
    eventKey: row.event_key,
    payload: parse(row.payload, {}),
    count: row.count,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
  }));

// ── Chatbot Memory ────────────────────────────────────────────────────────
const CHAT_MEMORY_MAX  = 25;
const CHAT_MEMORY_FACTS = [
  [/my name is ([A-Za-z][\w-]*)/i, 'name'],
  [/(?:i'm|i am) ([A-Za-z][\w-]*)(?:\s|$|,)/i, 'name'],
  [/call me ([A-Za-z][\w-]*)/i, 'name'],
  [/(?:i'm|i am) (\d{1,3})(?: years? old)?/i, 'age'],
  [/i work (?:as |at )([\w\s-]{3,40})/i, 'job'],
  [/i(?:'m| am) from ([A-Za-z\s]{3,30})/i, 'location'],
  [/i live in ([A-Za-z\s]{3,30})/i, 'location'],
  [/i (?:love|really like|like|enjoy) ([\w\s-]{3,40})/i, 'interest'],
  [/i (?:hate|dislike|can't stand) ([\w\s-]{3,40})/i, 'dislike'],
];
const CHAT_MEMORY_SKIP = new Set(['a', 'an', 'the', 'not', 'so', 'here', 'just', 'good', 'bad', 'fine', 'going', 'trying', 'using', 'happy', 'sad', 'tired', 'busy']);

function loadProfile(botId, userId) {
  const bId = String(botId || 'default').replace(/[^\w-]/g, '_');
  const uId = String(userId).replace(/[^\w]/g, '_');
  const row = stmts.getProfile.get(bId, uId);
  if (row) return parse(row.profile);
  const now = new Date().toISOString();
  return { userId, name: null, age: null, location: null, job: null, interests: [], dislikes: [], memories: [], messageCount: 0, firstSeen: now, lastSeen: now };
}

function saveProfile(botId, userId, profile) {
  const bId = String(botId || 'default').replace(/[^\w-]/g, '_');
  const uId = String(userId).replace(/[^\w]/g, '_');
  profile.lastSeen = new Date().toISOString();
  profile.messageCount = (profile.messageCount || 0) + 1;
  stmts.saveProfile.run(bId, uId, serial(profile));
  requestBackup('chat-profile');
  mirrorRemote('mirrorProfile', bId, uId, profile);
}

function learnFromMessage(text, profile) {
  const result = { ...profile, memories: [...(profile.memories || [])], interests: [...(profile.interests || [])], dislikes: [...(profile.dislikes || [])] };
  for (const [regex, tag] of CHAT_MEMORY_FACTS) {
    const match = String(text).match(regex);
    if (!match) continue;
    const raw = match[1].trim();
    if (!raw || raw.length > 60 || (tag === 'name' && CHAT_MEMORY_SKIP.has(raw.toLowerCase()))) continue;
    const value = raw.charAt(0).toUpperCase() + raw.slice(1);
    if (['name', 'age', 'location', 'job'].includes(tag) && !result[tag]) result[tag] = tag === 'age' ? `${value} years old` : value;
    if (tag === 'interest' && !result.interests.includes(value)) result.interests = [...result.interests, value].slice(-10);
    if (tag === 'dislike' && !result.dislikes.includes(value)) result.dislikes = [...result.dislikes, value].slice(-10);
    const memory = `User's ${tag}: ${value}`;
    if (!result.memories.some(item => item.toLowerCase() === memory.toLowerCase())) result.memories.unshift(memory);
  }
  result.memories = result.memories.slice(0, CHAT_MEMORY_MAX);
  return result;
}

function buildProfileContext(profile) {
  if (!profile) return '';
  const lines = [];
  for (const field of ['name', 'age', 'location', 'job']) if (profile[field]) lines.push(`- ${field}: ${profile[field]}`);
  if (profile.interests?.length) lines.push(`- interests: ${profile.interests.slice(0, 5).join(', ')}`);
  if (profile.dislikes?.length) lines.push(`- dislikes: ${profile.dislikes.slice(0, 5).join(', ')}`);
  if (profile.messageCount > 1) lines.push('- This is a returning user.');
  return lines.length ? `\nWhat you know about the user:\n${lines.join('\n')}\n` : '';
}

function getPersonalizedGreeting(profile) {
  return profile?.name ? `Hey ${profile.name}!` : null;
}

// ── Database health and graceful shutdown ─────────────────────────────────
let shutdownPromise = null;

async function shutdownDatabase() {
  if (shutdownPromise) return shutdownPromise;
  shuttingDown = true;
  shutdownPromise = (async () => {
    try {
      console.log('[DB] 🔄 Shutting down...');
      await ready;
      await flushBackup();
    } finally {
      try { db?.close(); } catch (_) {}
      try { await pgAdapter.close(); } catch (_) {}
      try { await mongoAdapter.close(); } catch (_) {}
      console.log('[DB] ✅ Closed');
    }
  })();
  return shutdownPromise;
}

const handleDatabaseSignal = () => {
  const appShutdown = global.__JUNE_SHUTDOWN;
  const shutdown = typeof appShutdown === 'function' ? appShutdown() : shutdownDatabase();
  Promise.resolve(shutdown).finally(() => process.exit(0));
};
process.once('SIGINT', handleDatabaseSignal);
process.once('SIGTERM', handleDatabaseSignal);
process.on('exit', () => { try { db.close(); } catch (_) {} });

// ── Health and Diagnostics ───────────────────────────────────────────────
function runIntegrityCheck() {
  const result = integrityCheck(db);
  lastIntegrityCheck = { ...result, checkedAt: Date.now() };
  return result;
}

function getDatabaseHealth() {
  let backupExists = false;
  let backupSizeBytes = 0;
  let backupValid = false;
  try {
    backupExists = fs.existsSync(DB_BACKUP_FILE);
    if (backupExists) {
      backupSizeBytes = fs.statSync(DB_BACKUP_FILE).size || 0;
      backupValid = validateBackup(DB_BACKUP_FILE);
    }
  } catch (_) {
    // A backup can be rotated between existsSync/statSync; report it as absent.
    backupExists = false;
    backupSizeBytes = 0;
    backupValid = false;
  }
  const dirty = dirtyRevision > backedUpRevision;

  try {
    const stats = fs.statSync(DB_FILE);
    const integrity = lastIntegrityCheck || { ok: true, result: 'not-yet-run', checkedAt: null };
    return {
      // Existing names retained for compatibility.
      ok: integrity.ok !== false,
      driver: dbDriver,
      schemaVersion: DB_SCHEMA_VERSION,
      file: DB_FILE,
      size: stats.size,
      lastIntegrity: integrity,
      lastBackup,
      maintenance: lastMaintenance,
      remoteSync: getRemoteSyncQueueStats(),
      postgres: pgAdapter.getStatus(),
      mongo: mongoAdapter.getStatus(),

      // Stable diagnostics API consumed by index.js /health/details.
      databaseSizeBytes: stats.size,
      backupSizeBytes,
      backupExists,
      backupValid,
      dirty,
      lastIntegrityCheck: integrity,
    };
  } catch (err) {
    const integrity = lastIntegrityCheck || { ok: false, result: err.message, checkedAt: null };
    return {
      ok: false,
      driver: dbDriver,
      schemaVersion: DB_SCHEMA_VERSION,
      file: DB_FILE,
      error: err.message,
      size: 0,
      lastIntegrity: integrity,
      lastBackup,
      maintenance: lastMaintenance,
      remoteSync: getRemoteSyncQueueStats(),
      postgres: pgAdapter.getStatus(),
      mongo: mongoAdapter.getStatus(),
      databaseSizeBytes: 0,
      backupSizeBytes,
      backupExists,
      backupValid,
      dirty,
      lastIntegrityCheck: integrity,
    };
  }
}

function markDatabaseDirty(reason = 'manual-mark') {
  requestBackup(String(reason || 'manual-mark').slice(0, 80));
}

async function restoreFromPostgres() {
  const result = await pgAdapter.restoreIntoSQLite(db);
  if (result?.restored > 0) requestBackup('postgres-restore');
  return result;
}

async function restoreFromMongo() {
  const result = await mongoAdapter.restoreIntoSQLite(db);
  if (result?.restored > 0) requestBackup('mongo-restore');
  return result;
}

module.exports = {
  ready,
  getGroupSettings, updateGroupSettings, getUser, updateUser,
  getWarnings, addWarning, removeWarning, clearWarnings,
  getModerators, addModerator, removeModerator, isModerator,
  muteUser, unmuteUser, isUserMuted, getMutedUsers,
  getBotSetting, setBotSetting, getStoredBotSettings, getAllBotSettings, updateBotSettings, BOT_SETTINGS_DEFAULTS,
  getBotMode, setBotMode, VALID_BOT_MODES,
  getAntiforwardSettings, updateAntiforwardSettings, addAntiforwardWarning, getAntiforwardWarningCount, clearAntiforwardWarning, clearAllAntiforwardWarnings,
  saveSession, getSession, clearSession,
  loadSettings, saveSettings, cleanEmoji, pickEmoji,
  getKV, setKV, delKV, getAllKV,
  getGroupStat, saveGroupStat, getAllGroupStats,
  saveAntideleteMessage, getAntideleteMessages, deleteAntideleteMessage,
  saveAntideleteStatus, getAntideleteStatuses, deleteAntideleteStatus,
  saveLidMap, getLidMap, getLidMaps,
  recordRuntimeTelemetry, getRuntimeTelemetry,
  loadProfile, saveProfile, learnFromMessage, buildProfileContext, getPersonalizedGreeting,
  runIntegrityCheck, getDatabaseHealth, createBackup: () => createAtomicBackup('manual'), flushBackup, shutdownDatabase, markDatabaseDirty,
  runDatabaseMaintenance, vacuumDatabase, pruneAntideleteData,
  processRemoteSyncQueue, getRemoteSyncQueueStats,
  restoreFromPostgres, restoreFromMongo,
  getPostgresStatus: pgAdapter.getStatus, getMongoStatus: mongoAdapter.getStatus,
  getBotId: pgAdapter.getBotId,
};

Object.defineProperty(module.exports, '_db', {
  enumerable: true,
  get() {
    return db;
  }
});
