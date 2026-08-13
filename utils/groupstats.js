'use strict';

/**
 * SQLite-backed group activity statistics.
 *
 * Public functions remain synchronous for compatibility with handler.js and
 * existing commands. Message activity is cached in memory and only dirty
 * group/day records are flushed to the main SQLite database every five seconds.
 *
 * This module intentionally has no file-based storage path. It never reads,
 * writes, imports, or falls back to a standalone statistics file.
 */

const database = require('../database');

const FLUSH_INTERVAL_MS = 5_000;

// Map<groupId, Map<YYYY-MM-DD, { total, users, hours }>>
const cache = new Map();
// Map<groupId, Set<YYYY-MM-DD>> — records awaiting the next SQLite save.
const dirtyDays = new Map();
// Only needed for the tiny startup window before database.ready resolves.
const preReadyDays = new Map();
const fullyLoadedGroups = new Set();

let databaseReady = false;
let flushInProgress = false;
let lastDatabaseErrorAt = 0;

function todayKey() {
  // Preserve the old utility's UTC date boundary.
  return new Date().toISOString().slice(0, 10);
}

function hourKey() {
  // Preserve the old utility's server-local hour bucket.
  return new Date().getHours().toString();
}

function toCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function normaliseCounterMap(value) {
  const output = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return output;

  for (const [key, count] of Object.entries(value)) {
    const safeCount = toCount(count);
    if (safeCount > 0) output[String(key)] = safeCount;
  }

  return output;
}

function normaliseStat(value) {
  const stat = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    total: toCount(stat.total),
    users: normaliseCounterMap(stat.users),
    hours: normaliseCounterMap(stat.hours),
  };
}

function mergeStats(persisted, inMemory) {
  const merged = normaliseStat(persisted);
  const pending = normaliseStat(inMemory);

  merged.total += pending.total;
  for (const [jid, count] of Object.entries(pending.users)) {
    merged.users[jid] = (merged.users[jid] || 0) + count;
  }
  for (const [hour, count] of Object.entries(pending.hours)) {
    merged.hours[hour] = (merged.hours[hour] || 0) + count;
  }

  return merged;
}

function normaliseGroupId(groupId) {
  return String(groupId || '');
}

function normaliseDate(date) {
  return String(date || '');
}

function getGroupDays(groupId) {
  const id = normaliseGroupId(groupId);
  let days = cache.get(id);
  if (!days) {
    days = new Map();
    cache.set(id, days);
  }
  return days;
}

function markDay(map, groupId, date) {
  const id = normaliseGroupId(groupId);
  const day = normaliseDate(date);
  let dates = map.get(id);
  if (!dates) {
    dates = new Set();
    map.set(id, dates);
  }
  dates.add(day);
}

function reportDatabaseError(error) {
  // Do not turn one SQLite outage into a console line for every group message.
  const now = Date.now();
  if (now - lastDatabaseErrorAt < 60_000) return;
  lastDatabaseErrorAt = now;
  console.error('[groupStats] SQLite error:', error?.message || error);
}

function loadDay(groupId, date) {
  const id = normaliseGroupId(groupId);
  const day = normaliseDate(date);
  const days = getGroupDays(id);

  if (days.has(day)) return days.get(day);
  if (!databaseReady) return null;

  try {
    const stored = database.getGroupStat(id, day);
    if (stored === null) return null;

    const stat = normaliseStat(stored);
    days.set(day, stat);
    return stat;
  } catch (error) {
    reportDatabaseError(error);
    return null;
  }
}

function ensureDay(groupId, date) {
  const id = normaliseGroupId(groupId);
  const day = normaliseDate(date);
  const existing = loadDay(id, day);
  if (existing) return existing;

  const stat = { total: 0, users: {}, hours: {} };
  getGroupDays(id).set(day, stat);
  if (!databaseReady) markDay(preReadyDays, id, day);
  return stat;
}

function loadAllGroupDays(groupId) {
  const id = normaliseGroupId(groupId);
  const days = getGroupDays(id);

  if (!databaseReady || fullyLoadedGroups.has(id)) return days;

  try {
    for (const row of database.getAllGroupStats(id)) {
      const day = normaliseDate(row.date);
      // Keep a newer in-memory record if messages have arrived since startup.
      if (!days.has(day)) days.set(day, normaliseStat(row.data));
    }
    fullyLoadedGroups.add(id);
  } catch (error) {
    reportDatabaseError(error);
  }

  return days;
}

function reconcilePreReadyDays() {
  if (!databaseReady || preReadyDays.size === 0) return;

  for (const [groupId, dates] of preReadyDays) {
    const days = getGroupDays(groupId);

    for (const date of dates) {
      const inMemory = days.get(date);
      if (!inMemory) continue;

      try {
        const stored = database.getGroupStat(groupId, date);
        if (stored !== null) days.set(date, mergeStats(stored, inMemory));
      } catch (error) {
        reportDatabaseError(error);
      }
    }
  }

  preReadyDays.clear();
}

function flushGroupStats() {
  if (!databaseReady || flushInProgress || dirtyDays.size === 0) return 0;

  flushInProgress = true;
  let saved = 0;

  try {
    for (const [groupId, dates] of [...dirtyDays.entries()]) {
      const days = getGroupDays(groupId);

      for (const date of [...dates]) {
        const stat = days.get(date);
        if (!stat) {
          dates.delete(date);
          continue;
        }

        try {
          database.saveGroupStat(groupId, date, stat);
          dates.delete(date);
          saved += 1;
        } catch (error) {
          // Keep the record dirty; the next scheduled flush retries it.
          reportDatabaseError(error);
        }
      }

      if (dates.size === 0) dirtyDays.delete(groupId);
    }
  } finally {
    flushInProgress = false;
  }

  return saved;
}

// ── Public API ────────────────────────────────────────────────────────────────

function addMessage(groupId, senderId) {
  const id = normaliseGroupId(groupId);
  const sender = String(senderId || '');
  if (!id || !sender) return;

  const date = todayKey();
  const stat = ensureDay(id, date);

  stat.total += 1;
  stat.users[sender] = (stat.users[sender] || 0) + 1;

  const hour = hourKey();
  stat.hours[hour] = (stat.hours[hour] || 0) + 1;

  markDay(dirtyDays, id, date);
}

function getStats(groupId) {
  return loadDay(groupId, todayKey());
}

function getActiveUsers(groupId, limit = 15) {
  const totals = {};

  for (const stat of loadAllGroupDays(groupId).values()) {
    for (const [jid, count] of Object.entries(stat.users || {})) {
      totals[jid] = (totals[jid] || 0) + toCount(count);
    }
  }

  const safeLimit = Math.max(0, Math.floor(Number(limit) || 0));
  return Object.entries(totals)
    .map(([jid, count]) => ({ jid, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, safeLimit);
}

function getInactiveUsers(groupId, allParticipants) {
  const active = new Set();

  for (const stat of loadAllGroupDays(groupId).values()) {
    for (const jid of Object.keys(stat.users || {})) active.add(jid);
  }

  return Array.isArray(allParticipants)
    ? allParticipants.filter(jid => !active.has(jid))
    : [];
}

// Same debounce as the previous implementation, but the destination is the
// main SQLite database instead of a standalone JSON file.
setInterval(flushGroupStats, FLUSH_INTERVAL_MS).unref();

// index.js already calls this hook before it closes SQLite during graceful
// shutdown. The prepended exit listener is a small fallback for direct exits.
global.__JUNE_FLUSH_GROUP_STATS = flushGroupStats;
process.prependListener('exit', flushGroupStats);

database.ready
  .then(() => {
    databaseReady = true;
    reconcilePreReadyDays();
    flushGroupStats();
  })
  .catch(() => {
    // index.js owns startup-failure reporting; keep this utility silent here.
  });

module.exports = {
  addMessage,
  getStats,
  getActiveUsers,
  getInactiveUsers,
  flush: flushGroupStats,
  flushGroupStats,
};
