// utils/groupstats.js
// SQLite-backed group statistics — same public API as before.
'use strict';

const { _db: db } = require('../database');

// Ensure table exists (database.js already creates it, this is a safety net)
db.exec(`
  CREATE TABLE IF NOT EXISTS group_stats (
    group_id TEXT NOT NULL,
    date     TEXT NOT NULL,
    data     TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (group_id, date)
  );
`);

const stmtGet    = db.prepare('SELECT data FROM group_stats WHERE group_id = ? AND date = ?');
const stmtUpsert = db.prepare('INSERT INTO group_stats (group_id, date, data) VALUES (?, ?, ?) ON CONFLICT(group_id, date) DO UPDATE SET data = excluded.data');
const stmtAll    = db.prepare('SELECT date, data FROM group_stats WHERE group_id = ?');

const parse  = (str) => { try { return JSON.parse(str); } catch { return {}; } };
const serial = (val) => JSON.stringify(val);

function addMessage(groupId, senderId) {
  const today = new Date().toISOString().slice(0, 10);
  const hour  = new Date().getHours().toString();

  const row = stmtGet.get(groupId, today);
  const day = row
    ? parse(row.data)
    : { total: 0, users: {}, hours: {} };

  day.total++;
  day.users[senderId] = (day.users[senderId] || 0) + 1;
  day.hours[hour]     = (day.hours[hour]     || 0) + 1;

  stmtUpsert.run(groupId, today, serial(day));
}

function getStats(groupId) {
  const today = new Date().toISOString().slice(0, 10);
  const row   = stmtGet.get(groupId, today);
  return row ? parse(row.data) : null;
}

function getActiveUsers(groupId, limit = 15) {
  const rows   = stmtAll.all(groupId);
  const totals = {};
  for (const { data } of rows) {
    const day = parse(data);
    for (const [jid, count] of Object.entries(day.users || {})) {
      totals[jid] = (totals[jid] || 0) + count;
    }
  }
  return Object.entries(totals)
    .map(([jid, count]) => ({ jid, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function getInactiveUsers(groupId, allParticipants) {
  const rows   = stmtAll.all(groupId);
  const active = new Set();
  for (const { data } of rows) {
    const day = parse(data);
    for (const jid of Object.keys(day.users || {})) active.add(jid);
  }
  return allParticipants.filter(jid => !active.has(jid));
}

module.exports = { addMessage, getStats, getActiveUsers, getInactiveUsers };
