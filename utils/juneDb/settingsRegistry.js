'use strict';

/**
 * Small, database-backed recovery snapshot for June X bot_settings.
 *
 * This intentionally snapshots only values already stored in bot_settings.
 * It does not inspect .env, session files, credentials, or arbitrary JSON files.
 */

const fs = require('fs');
const path = require('path');
const { atomicWriteFile } = require('./runtimeProtection');

const SNAPSHOT_FILE = path.join(__dirname, '..', '..', 'data', 'june-settings-recovery.json');
const SNAPSHOT_INTERVAL_MS = Math.max(
  60_000,
  Number(process.env.JUNE_SETTINGS_SNAPSHOT_INTERVAL_MS) || 5 * 60 * 1000
);
const MAX_ENTRY_BYTES = Math.max(
  1024,
  Number(process.env.JUNE_SETTINGS_SNAPSHOT_MAX_ENTRY_BYTES) || 512 * 1024
);

let timer = null;
let lastSnapshotAt = null;
let lastRestore = null;

function readSnapshot() {
  try {
    if (!fs.existsSync(SNAPSHOT_FILE)) return null;
    const value = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
    return value && typeof value === 'object' ? value : null;
  } catch (_) {
    return null;
  }
}

function safeStoredSettings(database) {
  try {
    return database.getStoredBotSettings?.() || {};
  } catch (_) {
    return {};
  }
}

function snapshot(database) {
  const source = safeStoredSettings(database);
  const settings = {};
  for (const [key, value] of Object.entries(source)) {
    try {
      if (JSON.stringify(value).length > MAX_ENTRY_BYTES) continue;
      settings[key] = value;
    } catch (_) {}
  }

  const payload = {
    version: 1,
    savedAt: Date.now(),
    settings,
  };
  try {
    atomicWriteFile(SNAPSHOT_FILE, JSON.stringify(payload, null, 2));
    lastSnapshotAt = payload.savedAt;
    return { ok: true, count: Object.keys(settings).length, savedAt: payload.savedAt };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function restoreIfNeeded(database) {
  const existing = safeStoredSettings(database);
  if (Object.keys(existing).length > 0) {
    lastRestore = { restored: 0, skipped: 'settings-present', timestamp: Date.now() };
    return lastRestore;
  }

  const snapshotData = readSnapshot();
  const settings = snapshotData?.settings;
  if (!settings || typeof settings !== 'object' || Object.keys(settings).length === 0) {
    lastRestore = { restored: 0, skipped: 'no-snapshot', timestamp: Date.now() };
    return lastRestore;
  }

  let restored = 0;
  for (const [key, value] of Object.entries(settings)) {
    try {
      database.setBotSetting(key, value);
      restored += 1;
    } catch (_) {}
  }
  lastRestore = { restored, timestamp: Date.now() };
  return lastRestore;
}

function start(database) {
  if (timer) return;
  snapshot(database);
  timer = setInterval(() => snapshot(database), SNAPSHOT_INTERVAL_MS);
  timer.unref?.();
}

function stop(database) {
  if (timer) clearInterval(timer);
  timer = null;
  return snapshot(database);
}

function getStatus() {
  return {
    file: SNAPSHOT_FILE,
    lastSnapshotAt,
    lastRestore,
    running: !!timer,
  };
}

module.exports = {
  snapshot,
  restoreIfNeeded,
  start,
  stop,
  getStatus,
};
