/**
 * Shared presence settings — read/write data/presence.json
 * Modes: 'off' | 'typing' | 'recording' | 'recordtype'
 */
const fs   = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '../data/presence.json');

function load() {
    try {
        return JSON.parse(fs.readFileSync(FILE, 'utf8'));
    } catch {
        return { mode: 'off' };
    }
}

function save(data) {
    try { fs.writeFileSync(FILE, JSON.stringify(data, null, 2)); } catch {}
}

function getMode() {
    return load().mode || 'off';
}

function setMode(mode) {
    save({ mode });
}

module.exports = { load, save, getMode, setMode };
