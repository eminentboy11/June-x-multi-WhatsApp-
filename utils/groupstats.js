// utils/groupStats.js
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../database/groupStats.json');

function loadDB() {
    try {
        if (!fs.existsSync(DB_PATH)) return {};
        return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    } catch {
        return {};
    }
}

function saveDB(data) {
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('[groupStats] save error:', err);
    }
}

function addMessage(groupId, senderId) {
    const db = loadDB();
    const today = new Date().toISOString().slice(0, 10);
    const hour = new Date().getHours().toString();

    if (!db[groupId]) db[groupId] = {};
    if (!db[groupId][today]) {
        db[groupId][today] = {
            total: 0,
            users: {},
            hours: {}
        };
    }

    const g = db[groupId][today];

    g.total++;
    g.users[senderId] = (g.users[senderId] || 0) + 1;
    g.hours[hour] = (g.hours[hour] || 0) + 1;

    saveDB(db);
}

function getStats(groupId) {
    const db = loadDB();
    const today = new Date().toISOString().slice(0, 10);

    if (!db[groupId] || !db[groupId][today]) return null;
    return db[groupId][today];
}

function getActiveUsers(groupId, limit = 15) {
    const db = loadDB();
    if (!db[groupId]) return [];

    const totals = {};
    for (const day of Object.values(db[groupId])) {
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
    const db = loadDB();
    const active = new Set();

    if (db[groupId]) {
        for (const day of Object.values(db[groupId])) {
            for (const jid of Object.keys(day.users || {})) {
                active.add(jid);
            }
        }
    }

    return allParticipants.filter(jid => !active.has(jid));
}

module.exports = { addMessage, getStats, getActiveUsers, getInactiveUsers };
