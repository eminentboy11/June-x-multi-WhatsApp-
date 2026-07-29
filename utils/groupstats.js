// utils/groupStats.js
// In-memory store with async flush — no sync disk I/O on every message.
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../database/groupStats.json');

// ── In-memory store ───────────────────────────────────────────────────────────
let _cache = null;   // null = not loaded yet
let _dirty = false;  // true = cache has unsaved changes

function _load() {
    if (_cache !== null) return;
    try {
        if (!fs.existsSync(DB_PATH)) { _cache = {}; return; }
        const raw = fs.readFileSync(DB_PATH, 'utf8').trim();
        _cache = raw ? JSON.parse(raw) : {};
    } catch {
        _cache = {};
    }
}

function _flushToDisk() {
    if (!_dirty || !_cache) return;
    _dirty = false;
    const json = JSON.stringify(_cache);
    const tmp  = DB_PATH + '.tmp';
    try {
        fs.writeFileSync(tmp, json);
        fs.renameSync(tmp, DB_PATH);
    } catch (err) {
        console.error('[groupStats] flush error:', err.message);
    }
}

// Flush every 5 seconds — only writes if something actually changed
setInterval(_flushToDisk, 5000).unref();

// Also flush on process exit so no data is lost on clean shutdown
process.on('exit', _flushToDisk);

// ── Public API ────────────────────────────────────────────────────────────────

function addMessage(groupId, senderId) {
    _load();
    const today = new Date().toISOString().slice(0, 10);
    const hour  = new Date().getHours().toString();

    if (!_cache[groupId]) _cache[groupId] = {};
    if (!_cache[groupId][today]) {
        _cache[groupId][today] = { total: 0, users: {}, hours: {} };
    }

    const g = _cache[groupId][today];
    g.total++;
    g.users[senderId] = (g.users[senderId] || 0) + 1;
    g.hours[hour]     = (g.hours[hour]     || 0) + 1;
    _dirty = true;
}

function getStats(groupId) {
    _load();
    const today = new Date().toISOString().slice(0, 10);
    if (!_cache[groupId] || !_cache[groupId][today]) return null;
    return _cache[groupId][today];
}

function getActiveUsers(groupId, limit = 15) {
    _load();
    if (!_cache[groupId]) return [];

    const totals = {};
    for (const day of Object.values(_cache[groupId])) {
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
    _load();
    const active = new Set();

    if (_cache[groupId]) {
        for (const day of Object.values(_cache[groupId])) {
            for (const jid of Object.keys(day.users || {})) {
                active.add(jid);
            }
        }
    }

    return allParticipants.filter(jid => !active.has(jid));
}

module.exports = { addMessage, getStats, getActiveUsers, getInactiveUsers };
