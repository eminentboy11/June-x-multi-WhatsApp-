/**
 * Multi-session refactor test suite.
 * Run: node test/multi-session.test.js
 */
'use strict';

const assert = require('assert');

// index.js sets these globals before loading the handler; replicate them so
// commands that resolve paths via global.__CORE__ load in the test too.
global.__CORE__ = require('path').join(__dirname, '..');
global.__ROOT__ = global.__CORE__;

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
    return Promise.resolve()
        .then(fn)
        .then(() => { passed++; console.log(`  ✓ ${name}`); })
        .catch((e) => { failed++; failures.push({ name, error: e }); console.log(`  ✗ ${name}\n    ${e.message}`); });
}

(async () => {
    console.log('\n[1] utils/botContext — ALS routing');
    const { runInBot, getCurrentBotId, scopedMap } = require('../utils/botContext');

    await test('runInBot scopes context (sync + async + timers)', async () => {
        assert.strictEqual(getCurrentBotId(), require('../utils/botContext').DEFAULT_BOT_ID);
        await runInBot('bot-a', async () => {
            assert.strictEqual(getCurrentBotId(), 'bot-a');
            await new Promise(r => setTimeout(r, 10)); // timers keep context
            assert.strictEqual(getCurrentBotId(), 'bot-a');
        });
        assert.strictEqual(getCurrentBotId(), require('../utils/botContext').DEFAULT_BOT_ID);
    });

    await test('scopedMap isolates caches per bot', () => {
        const cache = scopedMap(() => new Map());
        runInBot('a', () => cache.set('k', 'from-a'));
        runInBot('b', () => cache.set('k', 'from-b'));
        let aVal, bVal;
        runInBot('a', () => { aVal = cache.get('k'); });
        runInBot('b', () => { bVal = cache.get('k'); });
        assert.strictEqual(aVal, 'from-a');
        assert.strictEqual(bVal, 'from-b');
        cache.clearAllBots();
        runInBot('a', () => assert.strictEqual(cache.get('k'), undefined));
    });

    console.log('\n[2] database facade — per-bot databases');
    const db = require('../database');

    await test('per-bot DB files with isolated KV (mynote.js backing store)', async () => {
        const alpha = db.registerBotDatabase('alpha');
        const beta = db.registerBotDatabase('beta');
        await Promise.all([alpha.ready, beta.ready]);
        alpha.setKV('user_notes', 'u1', ['note-A1', 'note-A2']);
        beta.setKV('user_notes', 'u1', ['note-B1']);
        assert.deepStrictEqual(alpha.getKV('user_notes', 'u1', []), ['note-A1', 'note-A2']);
        assert.deepStrictEqual(beta.getKV('user_notes', 'u1', []), ['note-B1']);
        assert.deepStrictEqual(alpha.getKV('user_notes', 'u1', []).length, 2);
    });

    await test('ALS routing through the facade (command-style calls)', async () => {
        await runInBot('alpha', () => {
            db.setKV('test_ns', 'k', 'alpha-value');
        });
        await runInBot('beta', () => {
            db.setKV('test_ns', 'k', 'beta-value');
        });
        let aVal, bVal;
        await runInBot('alpha', () => { aVal = db.getKV('test_ns', 'k'); });
        await runInBot('beta', () => { bVal = db.getKV('test_ns', 'k'); });
        assert.strictEqual(aVal, 'alpha-value');
        assert.strictEqual(bVal, 'beta-value');
    });

    await test('per-bot settings (prefix, bot mode, warnings)', async () => {
        const alpha = db.getBotDatabase('alpha');
        const beta = db.getBotDatabase('beta');
        alpha.setBotSetting('prefix', '.');
        beta.setBotSetting('prefix', '!');
        alpha.setBotMode('public');
        beta.setBotMode('private');
        assert.strictEqual(alpha.getBotSetting('prefix'), '.');
        assert.strictEqual(beta.getBotSetting('prefix'), '!');
        assert.strictEqual(alpha.getBotMode(), 'public');
        assert.strictEqual(beta.getBotMode(), 'private');
        // isolation from the default (legacy) bot
        assert.notStrictEqual(db.getBotDatabase(db.DEFAULT_BOT_ID).getBotSetting('prefix'), '!');
    });

    await test('per-bot session error state (reconnect counters)', () => {
        const alpha = db.getBotDatabase('alpha');
        const beta = db.getBotDatabase('beta');
        alpha.setSessionErrorState({ count: 7, last_error_timestamp: 1 });
        beta.setSessionErrorState({ count: 2, last_error_timestamp: 2 });
        assert.strictEqual(alpha.getSessionErrorState().count, 7);
        assert.strictEqual(beta.getSessionErrorState().count, 2);
    });

    console.log('\n[3] config proxy — per-bot config');
    const config = require('../config');

    await test('per-bot config via ALS proxy', async () => {
        config.__registerBotConfig('alpha', config.__createBotConfig({ prefix: '.', botName: 'Alpha-Bot' }));
        config.__registerBotConfig('beta', config.__createBotConfig({ prefix: '#', botName: 'Beta-Bot' }));
        let aPrefix, bPrefix;
        await runInBot('alpha', () => { aPrefix = config.prefix; });
        await runInBot('beta', () => { bPrefix = config.prefix; });
        assert.strictEqual(aPrefix, '.');
        assert.strictEqual(bPrefix, '#');
        // defaultGroupSettings deep-cloned independently
        const cfgA = config.__getBotConfig('alpha');
        const cfgB = config.__getBotConfig('beta');
        cfgA.defaultGroupSettings.antilink = true;
        assert.strictEqual(cfgB.defaultGroupSettings.antilink, false);
    });

    console.log('\n[4] utils modules — ALS-aware settings');
    const settings = require('../utils/settings');
    const botMode = require('../utils/botMode');
    const autoReact = require('../utils/autoReact');
    const presence = require('../utils/presenceSettings');

    await test('settings.js get/set per bot', async () => {
        await runInBot('alpha', () => settings.set('prefix', '.'));
        await runInBot('beta', () => settings.set('prefix', '?'));
        let a, b;
        await runInBot('alpha', () => { a = settings.get('prefix'); });
        await runInBot('beta', () => { b = settings.get('prefix'); });
        assert.strictEqual(a, '.');
        assert.strictEqual(b, '?');
    });

    await test('botMode.js per bot', async () => {
        await runInBot('alpha', () => botMode.setMode('public'));
        await runInBot('beta', () => botMode.setMode('group'));
        let a, b;
        await runInBot('alpha', () => { a = botMode.getMode(); });
        await runInBot('beta', () => { b = botMode.getMode(); });
        assert.strictEqual(a, 'public');
        assert.strictEqual(b, 'group');
    });

    await test('autoReact.js per bot', async () => {
        await runInBot('alpha', () => autoReact.save({ enabled: true, mode: 'all' }));
        await runInBot('beta', () => autoReact.save({ enabled: false, mode: 'bot' }));
        let a, b;
        await runInBot('alpha', () => { a = autoReact.load(); });
        await runInBot('beta', () => { b = autoReact.load(); });
        assert.strictEqual(a.enabled, true);
        assert.strictEqual(b.enabled, false);
    });

    await test('presenceSettings.js per bot', async () => {
        await runInBot('alpha', () => presence.setMode('typing'));
        await runInBot('beta', () => presence.setMode('off'));
        let a, b;
        await runInBot('alpha', () => { a = presence.getModes(); });
        await runInBot('beta', () => { b = presence.getModes(); });
        assert.strictEqual(a.pm, 'typing');
        assert.strictEqual(b.pm, 'off');
    });

    console.log('\n[5] handler.js — per-bot caches');
    const h = require('../handler');

    await test('getCachedArSettings is per-bot scoped', async () => {
        await runInBot('alpha', () => autoReact.save({ enabled: true, mode: 'all' }));
        await runInBot('beta', () => autoReact.save({ enabled: false, mode: 'bot' }));
        // Prime both caches
        await runInBot('alpha', () => h.getCachedArSettings());
        await runInBot('beta', () => h.getCachedArSettings());
        let a, b;
        await runInBot('alpha', () => { a = h.getCachedArSettings(); });
        await runInBot('beta', () => { b = h.getCachedArSettings(); });
        assert.strictEqual(a.enabled, true);
        assert.strictEqual(b.enabled, false);
    });

    console.log('\n[6] commands/notes/mynote.js — end-to-end per-bot notes');
    const mynote = require('../commands/notes/mynote');
    const addnote = require('../commands/notes/addnote');

    function makeMockSock() {
        const sent = [];
        return {
            sent,
            sendMessage: async (jid, content) => { sent.push({ jid, content }); return {}; },
        };
    }
    function makeMsg(userId, chatId = '123@g.us') {
        return { key: { remoteJid: chatId, participant: `${userId}@s.whatsapp.net`, id: `msg-${Math.random()}` } };
    }

    await test('mynote.js adds/reads notes isolated per bot', async () => {
        // fresh start for both bots' note stores
        db.getBotDatabase('alpha').delKV('user_notes', '254711111111');
        db.getBotDatabase('beta').delKV('user_notes', '254711111111');
        const sockA = makeMockSock();
        const sockB = makeMockSock();
        const msgA = makeMsg('254711111111');
        const msgB = makeMsg('254711111111'); // same user in same chat — different bots

        await runInBot('alpha', () => addnote.execute(sockA, msgA, ['hello from alpha']));
        await runInBot('beta', () => addnote.execute(sockB, msgB, ['hello from beta']));

        // read back via mynote (list)
        await runInBot('alpha', () => mynote.execute(sockA, msgA, []));
        await runInBot('beta', () => mynote.execute(sockB, msgB, []));

        const alphaNotes = db.getBotDatabase('alpha').getKV('user_notes', '254711111111', []);
        const betaNotes = db.getBotDatabase('beta').getKV('user_notes', '254711111111', []);
        assert.strictEqual(alphaNotes.length, 1);
        assert.strictEqual(betaNotes.length, 1);
        assert.strictEqual(alphaNotes[0].text, 'hello from alpha');
        assert.strictEqual(betaNotes[0].text, 'hello from beta');
        // alpha must NOT see beta's note
        assert.ok(!alphaNotes.some(n => n.text === 'hello from beta'));
    });

    await test('mynote.js del deletes only the right bot\u2019s note', async () => {
        const sockA = makeMockSock();
        const msgA = makeMsg('254711111111');
        await runInBot('alpha', () => mynote.execute(sockA, msgA, ['del', '1']));
        const alphaNotes = db.getBotDatabase('alpha').getKV('user_notes', '254711111111', []);
        const betaNotes = db.getBotDatabase('beta').getKV('user_notes', '254711111111', []);
        assert.strictEqual(alphaNotes.length, 0);
        assert.strictEqual(betaNotes.length, 1); // untouched
    });

    console.log('\n[7] sessionManager — registry parsing');
    const sm = require('../utils/sessionManager');

    await test('parseSessionsJson accepts array and {sessions:[...]}', () => {
        assert.strictEqual(sm.parseSessionsJson('[{"id":"x"}]').length, 1);
        assert.strictEqual(sm.parseSessionsJson('{"sessions":[{"id":"x"},{"id":"y"}]}').length, 2);
        assert.strictEqual(sm.parseSessionsJson('not json'), null);
    });

    await test('BotInstance carries independent runtime state', () => {
        const { SessionManager } = require('../utils/sessionManager');
        const manager = new SessionManager();
        const a = manager.register({ id: 'a', name: 'A' });
        const b = manager.register({ id: 'b', name: 'B' });
        a.botState = 'connected';
        a.errorRetryCount = 5;
        assert.strictEqual(b.botState, 'disconnected');
        assert.strictEqual(b.errorRetryCount, 0);
        const snap = manager.snapshot();
        assert.strictEqual(snap.length, 2);
        assert.ok(snap.find(s => s.id === 'a').connected);
    });

    await test('sessionLogLabel tags the CMD log box per session (last 3 digits)', () => {
        const { sessionLogLabel } = require('../utils/sessionManager');
        assert.strictEqual(sessionLogLabel('2348165321909'), 'JUNE ULTRA 909');
        assert.strictEqual(sessionLogLabel('2348154853640'), 'JUNE ULTRA 640');
        assert.strictEqual(sessionLogLabel('254798570132'), 'JUNE ULTRA 132');
        assert.strictEqual(sessionLogLabel('254712345678:12@s.whatsapp.net'), 'JUNE ULTRA 678');
        assert.strictEqual(sessionLogLabel('254798570132:12'), 'JUNE ULTRA 132');
        assert.strictEqual(sessionLogLabel(2348165321909), 'JUNE ULTRA 909');
        assert.strictEqual(sessionLogLabel(''), 'JUNE ULTRA ···');
        assert.strictEqual(sessionLogLabel(null), 'JUNE ULTRA ···');
        assert.strictEqual(sessionLogLabel(undefined), 'JUNE ULTRA ···');
        assert.strictEqual(sessionLogLabel('9'), 'JUNE ULTRA 009');
    });

    await test('sessionLogPrefix: classic in single mode, tagged per session in multi mode', () => {
        const { sessionLogPrefix, BotInstance } = require('../utils/sessionManager');
        const bot = new BotInstance({ id: 'main' });
        // Single-session / legacy mode — always the classic prefix.
        assert.strictEqual(sessionLogPrefix(bot, false), '[ JUNEX ULTRA ]');
        assert.strictEqual(sessionLogPrefix(null, true), '[ JUNEX ULTRA ]');
        // Multi-session mode, number known → last 3 digits.
        bot.accountNumber = '2348165321909';
        assert.strictEqual(sessionLogPrefix(bot, true), '[ JUNEX ULTRA 909 ]');
        bot.accountNumber = '2348154853640';
        assert.strictEqual(sessionLogPrefix(bot, true), '[ JUNEX ULTRA 640 ]');
        // Multi-session mode, number not known yet → session id tag.
        bot.accountNumber = null;
        assert.strictEqual(sessionLogPrefix(bot, true), '[ JUNEX ULTRA main ]');
    });

    console.log('\n[9] per-session restart command');
    const restartCmd = require('../commands/owner/restart');

    await test('.restart routes to the per-session hook — only that bot restarts', async () => {
        const oldExit = process.exit;
        const oldHook = global.__JUNE_RESTART_SESSION;
        let exitCode = null;
        let hookCalledWith = null;
        process.exit = (code) => { exitCode = code; };
        global.__JUNE_RESTART_SESSION = (botId) => {
            hookCalledWith = botId;
            return Promise.resolve({ ok: true, id: botId, sock: { sendMessage: () => Promise.resolve() } });
        };
        const sock = { sendMessage: async () => {} };
        const msg = { key: { remoteJid: 'abc@g.us', id: 'x' } };
        const extra = { reply: async () => {} };
        await runInBot('alpha', () => restartCmd.execute(sock, msg, [], extra));
        await new Promise((r) => setTimeout(r, 700));
        assert.strictEqual(hookCalledWith, 'alpha'); // the session that received it
        assert.strictEqual(exitCode, null);          // process NOT killed
        global.__JUNE_RESTART_SESSION = oldHook;
        process.exit = oldExit;
    });

    await test('legacy fallback: process.exit when the hook is missing', async () => {
        const oldExit = process.exit;
        const oldHook = global.__JUNE_RESTART_SESSION;
        let exitCode = null;
        process.exit = (code) => { exitCode = code; };
        global.__JUNE_RESTART_SESSION = undefined;
        const sock = { sendMessage: async () => {} };
        const msg = { key: { remoteJid: 'abc@g.us', id: 'y' } };
        const extra = { reply: async () => {} };
        await runInBot('alpha', () => restartCmd.execute(sock, msg, [], extra));
        await new Promise((r) => setTimeout(r, 700));
        assert.strictEqual(exitCode, 1);
        global.__JUNE_RESTART_SESSION = oldHook;
        process.exit = oldExit;
    });

    console.log('\n[10] pairing-cycle state machine');
    const { parsePairingMaxAttempts, BotInstance } = require('../utils/sessionManager');

    await test('parsePairingMaxAttempts: default 5, rejects invalid values', () => {
        assert.strictEqual(parsePairingMaxAttempts(undefined), 5);
        assert.strictEqual(parsePairingMaxAttempts('5'), 5);
        assert.strictEqual(parsePairingMaxAttempts('3'), 3);
        assert.strictEqual(parsePairingMaxAttempts('0'), 5);
        assert.strictEqual(parsePairingMaxAttempts('-2'), 5);
        assert.strictEqual(parsePairingMaxAttempts('abc'), 5);
    });

    await test('parsePairingMaxAttempts: fractional floors to valid ints', () => {
        assert.strictEqual(parsePairingMaxAttempts('2.9'), 2);
    });

    await test('armPairingCycle starts a fresh cycle and keeps configured phone', () => {
        const bot = new BotInstance({ id: 'a', phone: '2348165321909' });
        bot.pairingAttempts = 4;
        bot.pairingExhausted = true;
        const phone = bot.armPairingCycle();
        assert.strictEqual(phone, '2348165321909');
        assert.strictEqual(bot.pairingAttempts, 0);
        assert.strictEqual(bot.pairingExhausted, false);
        assert.strictEqual(bot._pairingPhone, '2348165321909');
        assert.strictEqual(bot.phone, '2348165321909'); // configured phone intact
    });

    await test('notePairingAttempt counts codes and exhausts exactly at the limit', () => {
        const bot = new BotInstance({ id: 'b', phone: '234800000000' });
        bot.armPairingCycle();
        assert.strictEqual(bot.notePairingAttempt(5), 1);
        assert.strictEqual(bot.pairingExhausted, false);
        bot.notePairingAttempt(5); bot.notePairingAttempt(5); bot.notePairingAttempt(5);
        assert.strictEqual(bot.pairingAttempts, 4);
        assert.strictEqual(bot.pairingExhausted, false);
        bot.notePairingAttempt(5);
        assert.strictEqual(bot.pairingAttempts, 5);
        assert.strictEqual(bot.pairingExhausted, true);
    });

    await test('clearPairingState resets transient state but NEVER the configured phone', () => {
        const bot = new BotInstance({ id: 'c', phone: '2348154853640' });
        bot.armPairingCycle();
        bot.notePairingAttempt(5);
        bot.notePairingAttempt(5);
        bot.clearPairingState();
        assert.strictEqual(bot._pairingPhone, null);
        assert.strictEqual(bot.pairingAttempts, 0);
        assert.strictEqual(bot.pairingExhausted, false);
        assert.strictEqual(bot.phone, '2348154853640'); // survives — re-arms after logout
        // and a fresh cycle can start from it immediately
        const phone = bot.armPairingCycle();
        assert.strictEqual(phone, '2348154853640');
    });

    await test('a new logout re-arms a full fresh cycle (attempt counter reset)', () => {
        const bot = new BotInstance({ id: 'd', phone: '234900000000' });
        bot.armPairingCycle();
        bot.notePairingAttempt(5); bot.notePairingAttempt(5); bot.notePairingAttempt(5);
        bot.notePairingAttempt(5); bot.notePairingAttempt(5); // exhausted
        assert.strictEqual(bot.pairingExhausted, true);
        // simulated logout -> fallbackToPairing re-arms
        bot.armPairingCycle();
        assert.strictEqual(bot.pairingExhausted, false);
        assert.strictEqual(bot.pairingAttempts, 0);
        assert.strictEqual(bot._pairingPhone, '234900000000');
    });

    await test('pairing state is isolated per bot', () => {
        const a = new BotInstance({ id: 'a', phone: '111' });
        const b = new BotInstance({ id: 'b', phone: '222' });
        a.armPairingCycle();
        a.notePairingAttempt(5); a.notePairingAttempt(5);
        assert.strictEqual(a.pairingAttempts, 2);
        assert.strictEqual(b.pairingAttempts, 0);
        assert.strictEqual(b.pairingExhausted, false);
    });

    console.log('\n[12] simplified registry (sessionId + phone only)');
    const { normalizeSessionEntries, loadSessionRegistry } = require('../utils/sessionManager');

    await test('id is derived from the phone automatically', () => {
        const entries = normalizeSessionEntries([
            { sessionId: 'JUNE-MD:~abc', phone: '2348154853640' },
        ]);
        assert.strictEqual(entries.length, 1);
        assert.strictEqual(entries[0].id, '2348154853640');
        assert.strictEqual(entries[0].phone, '2348154853640');
        assert.strictEqual(entries[0].sessionId, 'JUNE-MD:~abc');
    });

    await test('duplicate phones get -2, -3 suffixes (two sessions, one number)', () => {
        const entries = normalizeSessionEntries([
            { sessionId: 'JUNE-MD:~a', phone: '2348154853640' },
            { sessionId: 'JUNE-MD:~b', phone: '2348154853640' },
            { sessionId: 'JUNE-MD:~c', phone: '2348154853640' },
        ]);
        assert.deepStrictEqual(entries.map((e) => e.id), [
            '2348154853640',
            '2348154853640-2',
            '2348154853640-3',
        ]);
    });

    await test('name is derived as "June X <last3>" and is NOT botName-explicit', () => {
        const entries = normalizeSessionEntries([
            { sessionId: '', phone: '2348165321909' },
        ]);
        assert.strictEqual(entries[0].name, 'June X 909');
        assert.strictEqual(entries[0].nameExplicit, false);
    });

    await test('explicit id/name act as overrides (and name becomes botName-explicit)', () => {
        const entries = normalizeSessionEntries([
            { sessionId: '', phone: '234800000000', id: 'client-one', name: 'Client Bot' },
        ]);
        assert.strictEqual(entries[0].id, 'client-one');
        assert.strictEqual(entries[0].name, 'Client Bot');
        assert.strictEqual(entries[0].nameExplicit, true);
    });

    await test('sessionId-only entries still work (id falls back to default)', () => {
        const entries = normalizeSessionEntries([
            { sessionId: 'JUNE-MD:~only', phone: '' },
        ]);
        assert.strictEqual(entries.length, 1);
        assert.strictEqual(entries[0].sessionId, 'JUNE-MD:~only');
        assert.ok(entries[0].id);
    });

    await test('entries with neither id, sessionId nor phone are dropped', () => {
        const entries = normalizeSessionEntries([
            { name: 'ghost' },
            { sessionId: '', phone: '' },
        ]);
        assert.strictEqual(entries.length, 0);
    });

    await test('legacy 4-field format still parses unchanged (backward compat)', () => {
        const entries = normalizeSessionEntries([
            { id: 'main', name: 'Main Bot', sessionId: 'JUNE-MD:~x', phone: '2348154853640' },
            { id: 'backup', name: 'Backup', sessionId: '', phone: '2348165321909' },
        ]);
        assert.strictEqual(entries[0].id, 'main');
        assert.strictEqual(entries[0].name, 'Main Bot');
        assert.strictEqual(entries[1].id, 'backup');
    });

    await test('explicit id colliding with a derived id gets suffixed (never shared)', () => {
        const entries = normalizeSessionEntries([
            { sessionId: '', phone: '2348154853640' },
            { sessionId: '', phone: '234800000000', id: '2348154853640' },
        ]);
        assert.strictEqual(entries[0].id, '2348154853640');
        assert.strictEqual(entries[1].id, '2348154853640-2');
    });

    await test('sessionLogPrefix uses the configured phone before the number is known', () => {
        const { sessionLogPrefix, BotInstance } = require('../utils/sessionManager');
        const bot = new BotInstance({ id: '2348154853640', phone: '2348154853640' });
        assert.strictEqual(sessionLogPrefix(bot, true), '[ JUNEX ULTRA 640 ]');
        // with only the derived numeric id and no phone, use last-3 of the id
        const bot2 = new BotInstance({ id: '2348165321909', phone: '' });
        assert.strictEqual(sessionLogPrefix(bot2, true), '[ JUNEX ULTRA 909 ]');
    });

    console.log('\n[13] JUNE_SESSIONS as the sole session configuration');
    const smModule = require('../utils/sessionManager');

    await test('loadSessionRegistry: no registry -> single default session (first-run flow)', async () => {
        const oldEnv = process.env.JUNE_SESSIONS;
        delete process.env.JUNE_SESSIONS;
        const entries = loadSessionRegistry();
        assert.strictEqual(entries.length, 1);
        assert.strictEqual(entries[0].id, require('../utils/botContext').DEFAULT_BOT_ID);
        assert.strictEqual(entries[0].phone, '');
        assert.strictEqual(entries[0].sessionId, '');
        if (oldEnv) process.env.JUNE_SESSIONS = oldEnv;
    });

    await test('loadSessionRegistry: sessions.json is NOT a configuration source', async () => {
        const fs = require('fs');
        const path = require('path');
        const filePath = path.join(__dirname, '..', 'sessions.json');
        const oldEnv = process.env.JUNE_SESSIONS;
        delete process.env.JUNE_SESSIONS;
        // Plant a sessions.json full of entries — it must be completely ignored.
        fs.writeFileSync(filePath, JSON.stringify({ sessions: [
            { sessionId: 'JUNE-MD:~ignored', phone: '234899999999' },
        ] }));
        try {
            const entries = loadSessionRegistry();
            assert.strictEqual(entries.length, 1); // only the default session
            assert.strictEqual(entries[0].phone, '');
            assert.strictEqual(entries[0].sessionId, '');
        } finally {
            try { fs.rmSync(filePath, { force: true }); } catch (_) {}
            if (oldEnv) process.env.JUNE_SESSIONS = oldEnv;
        }
    });

    await test('loadSessionRegistry: one env entry behaves like single-session mode', () => {
        const oldEnv = process.env.JUNE_SESSIONS;
        process.env.JUNE_SESSIONS = '[{"sessionId":"JUNE-MD:~abc","phone":"2348154853640"}]';
        const entries = loadSessionRegistry();
        assert.strictEqual(entries.length, 1);
        assert.strictEqual(entries[0].id, '2348154853640');
        assert.strictEqual(entries[0].sessionId, 'JUNE-MD:~abc');
        assert.strictEqual(entries[0].phone, '2348154853640');
        if (oldEnv === undefined) delete process.env.JUNE_SESSIONS; else process.env.JUNE_SESSIONS = oldEnv;
    });

    await test('loadSessionRegistry: multiple entries boot from the same pipeline', () => {
        const oldEnv = process.env.JUNE_SESSIONS;
        process.env.JUNE_SESSIONS = '[{"sessionId":"JUNE-MD:~a","phone":"2348154853640"},{"sessionId":"","phone":"2348165321909"}]';
        const entries = loadSessionRegistry();
        assert.strictEqual(entries.length, 2);
        assert.deepStrictEqual(entries.map((e) => e.id), ['2348154853640', '2348165321909']);
        assert.strictEqual(entries[0].sessionId, 'JUNE-MD:~a');
        assert.strictEqual(entries[1].sessionId, '');
        if (oldEnv === undefined) delete process.env.JUNE_SESSIONS; else process.env.JUNE_SESSIONS = oldEnv;
    });

    console.log('\n[14] .addbot — validation, dedupe and command wiring');
    const { validateSessionEntry, addSessionEntry, VALID_PREFIXES } = require('../utils/sessionManager');
    const addbotCmd = require('../commands/owner/addbot');

    await test('validateSessionEntry: valid phone + sessionId', () => {
        const r = validateSessionEntry({ phone: '+234 816 532 1909', sessionId: 'JUNE-MD:~abc' });
        assert.strictEqual(r.ok, true);
        assert.strictEqual(r.phone, '2348165321909');
        assert.strictEqual(r.sessionId, 'JUNE-MD:~abc');
    });

    await test('validateSessionEntry: rejects bad phones and bad sessionIds', () => {
        assert.strictEqual(validateSessionEntry({ phone: 'abc' }).ok, false);
        assert.strictEqual(validateSessionEntry({ phone: '123' }).ok, false);
        assert.strictEqual(validateSessionEntry({ phone: '' }).ok, false);
        const badSid = validateSessionEntry({ phone: '2348165321909', sessionId: 'NOT-A-PREFIX:~x' });
        assert.strictEqual(badSid.ok, false);
        assert.strictEqual(badSid.reason, 'invalid-sessionId');
        // phone-only entry is valid (pairing login)
        assert.strictEqual(validateSessionEntry({ phone: '2348165321909' }).ok, true);
    });

    await test('addSessionEntry: appends and rejects duplicates (phone or sessionId)', () => {
        const registry = [{ sessionId: 'JUNE-MD:~a', phone: '2348154853640' }];
        const ok = addSessionEntry(registry, { sessionId: '', phone: '2348165321909' });
        assert.strictEqual(ok.ok, true);
        assert.strictEqual(ok.registry.length, 2);
        assert.deepStrictEqual(ok.entry, { sessionId: '', phone: '2348165321909' });
        // duplicate phone
        const dupePhone = addSessionEntry(ok.registry, { sessionId: '', phone: '2348154853640' });
        assert.strictEqual(dupePhone.ok, false);
        assert.strictEqual(dupePhone.reason, 'duplicate');
        // duplicate sessionId
        const dupeSid = addSessionEntry(ok.registry, { sessionId: 'JUNE-MD:~a', phone: '234800000000' });
        assert.strictEqual(dupeSid.ok, false);
        // original registry untouched by pure helper
        assert.strictEqual(registry.length, 1);
    });

    await test('addSessionEntry: invalid input never mutates the registry', () => {
        const registry = [{ sessionId: '', phone: '2348154853640' }];
        assert.strictEqual(addSessionEntry(registry, { phone: 'x' }).ok, false);
        assert.strictEqual(registry.length, 1);
    });

    await test('addbot command: valid input routes to the hook WITH chat meta — reaction only, no text spam', async () => {
        const oldHook = global.__JUNE_ADD_SESSION;
        const { runInBot } = require('../utils/botContext');
        let calledWith = null;
        let calledMeta = null;
        let replies = [];
        let reactions = [];
        global.__JUNE_ADD_SESSION = (entry, meta) => {
            calledWith = entry;
            calledMeta = meta;
            return Promise.resolve({ ok: true, id: '2348165321909', phone: entry.phone, sessionId: entry.sessionId, persisted: true });
        };
        const msg = { key: { remoteJid: 'chat@g.us', id: 'MSGID1' } };
        const extra = {
            reply: async (t) => { replies.push(t); },
            react: async (e) => { reactions.push(e); },
        };
        await runInBot('via-bot', () => addbotCmd.execute({}, msg, ['+234 816 532 1909', 'JUNE-MD:~xxxxx'], extra));
        assert.deepStrictEqual(calledWith, { phone: '2348165321909', sessionId: 'JUNE-MD:~xxxxx' });
        // flow meta: same-chat delivery + which session delivers + quote key
        assert.strictEqual(calledMeta.chatJid, 'chat@g.us');
        assert.strictEqual(calledMeta.viaBotId, 'via-bot');
        assert.deepStrictEqual(calledMeta.quotedKey, msg.key);
        // progress = reactions only; NO processing text messages
        assert.deepStrictEqual(reactions, ['⏳']);
        assert.strictEqual(replies.length, 0);
        global.__JUNE_ADD_SESSION = oldHook;
    });

    await test('addbot command: invalid phone is rejected before the hook runs', async () => {
        const oldHook = global.__JUNE_ADD_SESSION;
        let called = false;
        let replies = [];
        global.__JUNE_ADD_SESSION = () => { called = true; return Promise.resolve({ ok: true }); };
        const extra = { reply: async (t) => { replies.push(t); } };
        await addbotCmd.execute({}, {}, ['not-a-number'], extra);
        assert.strictEqual(called, false);
        assert.ok(replies[0].includes('Invalid phone'));
        global.__JUNE_ADD_SESSION = oldHook;
    });

    await test('addbot command: invalid sessionId is rejected before the hook runs', async () => {
        const oldHook = global.__JUNE_ADD_SESSION;
        let called = false;
        let replies = [];
        global.__JUNE_ADD_SESSION = () => { called = true; return Promise.resolve({ ok: true }); };
        const extra = { reply: async (t) => { replies.push(t); } };
        await addbotCmd.execute({}, {}, ['2348165321909', 'BOGUS:~zzz'], extra);
        assert.strictEqual(called, false);
        assert.ok(replies[0].includes('Invalid sessionId'));
        global.__JUNE_ADD_SESSION = oldHook;
    });

    await test('addbot command: duplicate rejection surfaces a clear error', async () => {
        const oldHook = global.__JUNE_ADD_SESSION;
        let replies = [];
        global.__JUNE_ADD_SESSION = () => Promise.resolve({ ok: false, reason: 'duplicate' });
        const extra = { reply: async (t) => { replies.push(t); }, react: async () => {} };
        await addbotCmd.execute({}, { key: { remoteJid: 'c@g.us' } }, ['2348165321909', ''], extra);
        assert.ok(replies[0].includes('already registered'));
        global.__JUNE_ADD_SESSION = oldHook;
    });

    await test('addbot command: quota and device-limit rejections explain themselves', async () => {
        const oldHook = global.__JUNE_ADD_SESSION;
        let replies = [];
        const extra = { reply: async (t) => { replies.push(t); }, react: async () => {} };
        const msg = { key: { remoteJid: 'c@g.us' } };
        global.__JUNE_ADD_SESSION = () => Promise.resolve({ ok: false, reason: 'quota', total: 10, limit: 10 });
        await addbotCmd.execute({}, msg, ['2348165321909', ''], extra);
        assert.ok(replies[0].includes('Session limit reached'));
        global.__JUNE_ADD_SESSION = () => Promise.resolve({ ok: false, reason: 'device-limit', limit: 4 });
        await addbotCmd.execute({}, msg, ['2348165321909', ''], extra);
        assert.ok(replies[1].includes('Device limit'));
        global.__JUNE_ADD_SESSION = oldHook;
    });

    console.log('\n[15] startup-report presentation rule (single-session feature)');
    await test('VALID_PREFIXES shared by the .addbot command and index bootstrap', () => {
        assert.deepStrictEqual(VALID_PREFIXES, ['JUNE-MD:~', 'Ultra-X:~', 'June-Ultra:~', 'June::~']);
        assert.ok(VALID_PREFIXES.every((p) => 'JUNE-MD:~x'.startsWith(p) || 'Ultra-X:~x'.startsWith(p) || 'June-Ultra:~x'.startsWith(p) || 'June::~x'.startsWith(p)));
    });

    await test('loadSessionRegistry: no SESSION_ID/JUNE_PAIRING_NUMBER reading anywhere', () => {
        // Set the removed legacy vars — they must be completely ignored.
        const oldSid = process.env.SESSION_ID;
        const oldPin = process.env.JUNE_PAIRING_NUMBER;
        const oldReg = process.env.JUNE_SESSIONS;
        process.env.SESSION_ID = 'JUNE-MD:~shouldBeIgnored';
        process.env.JUNE_PAIRING_NUMBER = '234899999999';
        delete process.env.JUNE_SESSIONS;
        const entries = loadSessionRegistry();
        assert.strictEqual(entries.length, 1); // only the default session
        assert.strictEqual(entries[0].sessionId, ''); // legacy var ignored
        assert.strictEqual(entries[0].phone, '');      // legacy var ignored
        if (oldSid === undefined) delete process.env.SESSION_ID; else process.env.SESSION_ID = oldSid;
        if (oldPin === undefined) delete process.env.JUNE_PAIRING_NUMBER; else process.env.JUNE_PAIRING_NUMBER = oldPin;
        if (oldReg === undefined) delete process.env.JUNE_SESSIONS; else process.env.JUNE_SESSIONS = oldReg;
    });
    const { SessionManager } = require('../utils/sessionManager');

    await test('SessionManager.remove stops ONLY that session', async () => {
        const manager = new SessionManager();
        const sockA = { closed: false, ev: { removeAllListeners() {}, on() {} }, ws: { close() {} }, end() {} };
        const sockB = { closed: false, ev: { removeAllListeners() {}, on() {} }, ws: { close() {} }, end() {} };
        const a = manager.register({ id: 'a', name: 'A' });
        const b = manager.register({ id: 'b', name: 'B' });
        a.sock = sockA;
        b.sock = sockB;
        const removed = await manager.remove('a');
        assert.strictEqual(removed, true);
        assert.strictEqual(manager.get('a'), null);
        assert.ok(manager.get('b'));
        assert.strictEqual(manager.ids().join(','), 'b');
    });

    await test('unregisterBotDatabase closes one bot and survives re-registration', async () => {
        const dbModule = require('../database');
        const dbBot = dbModule.registerBotDatabase('hotbot');
        await dbBot.ready;
        dbBot.setKV('user_notes', 'u1', ['persisted-note']);
        const removed = await dbModule.unregisterBotDatabase('hotbot');
        assert.strictEqual(removed, true);
        assert.strictEqual(dbModule.getBotDatabase('hotbot'), null);
        // re-add creates a FRESH instance reading the SAME file — data persists
        const again = dbModule.registerBotDatabase('hotbot');
        await again.ready;
        assert.deepStrictEqual(again.getKV('user_notes', 'u1', []), ['persisted-note']);
        await dbModule.unregisterBotDatabase('hotbot');
    });

    await test('unregisterBotDatabase refuses to remove the default bot', async () => {
        const dbModule = require('../database');
        const result = await dbModule.unregisterBotDatabase(dbModule.DEFAULT_BOT_ID);
        assert.strictEqual(result, false);
        assert.ok(dbModule.getBotDatabase(dbModule.DEFAULT_BOT_ID));
    });

    await test('adapter unregister drops only that bot\u2019s instance', () => {
        const pgModule = require('../utils/juneDb/pgAdapter');
        const mgModule = require('../utils/juneDb/mongoAdapter');
        pgModule.forBot('x-hot'); mgModule.forBot('x-hot');
        assert.ok(pgModule.listBotIds().includes('x-hot'));
        const removed = pgModule.unregister('x-hot');
        assert.strictEqual(removed, true);
        assert.ok(!pgModule.listBotIds().includes('x-hot'));
        // re-request creates a fresh instance
        const fresh = pgModule.forBot('x-hot');
        assert.ok(fresh && typeof fresh.getBotId === 'function');
        mgModule.unregister('x-hot');
        pgModule.unregister('x-hot');
    });

    console.log('\n[8] adapters — per-bot ids');
    const pg = require('../utils/juneDb/pgAdapter');
    const mg = require('../utils/juneDb/mongoAdapter');

    await test('adapter instances are per bot', () => {
        assert.strictEqual(pg.forBot('alpha').getBotId(), 'alpha');
        assert.strictEqual(pg.forBot('beta').getBotId(), 'beta');
        assert.strictEqual(mg.forBot('alpha').getBotId(), 'alpha');
        pg.forBot('alpha').setBotId('renamed');
        assert.strictEqual(pg.forBot('alpha').getBotId(), 'renamed');
        assert.strictEqual(pg.forBot('beta').getBotId(), 'beta');
        assert.strictEqual(pg.forBot('default-x').getBotId(), 'default-x');
    });

    console.log('\n[16] deployment Super Owner foundation');
    const ownership = require('../utils/ownership');
    const anchorDb = require('../database');
    const SUPER_NUMBER = '234800000111';
    const OTHER_NUMBER = '234800000222';
    const jid = (num) => `${num}@s.whatsapp.net`;

    await test('fresh deployment: no Super Owner until first initialization', async () => {
        await anchorDb.ready;
        assert.strictEqual(ownership.hasSuperOwner(), false);
        assert.strictEqual(ownership.getSuperOwner(), null);
        assert.strictEqual(ownership.isSuperOwner(jid(SUPER_NUMBER)), false);
        // indicator shows nothing is established yet
        assert.strictEqual(ownership.superOwnerStatusFor(SUPER_NUMBER), '—');
    });

    await test('bootstrap window: legacy config.ownerNumber authorizes platform checks', () => {
        const configBase = require('../config');
        const legacyNumber = String(configBase.ownerNumber[0]).replace(/\D/g, '');
        assert.strictEqual(ownership.isPlatformOwner(jid(legacyNumber)), true);
        // an unknown number must NOT pass, even before establishment
        assert.strictEqual(ownership.isPlatformOwner(jid('234899999999')), false);
    });

    await test('claimSuperOwner: ineligible sessions can NEVER claim', () => {
        const res = ownership.claimSuperOwner(SUPER_NUMBER, { eligible: false });
        assert.strictEqual(res.established, false);
        assert.strictEqual(ownership.hasSuperOwner(), false);
    });

    await test('claimSuperOwner: first eligible initial session establishes it', () => {
        const res = ownership.claimSuperOwner(SUPER_NUMBER, { eligible: true });
        assert.strictEqual(res.established, true);
        assert.strictEqual(res.superOwner, SUPER_NUMBER);
        assert.strictEqual(ownership.getSuperOwner(), SUPER_NUMBER);
    });

    await test('claimSuperOwner: LOCKED — a second session can never overwrite', () => {
        const res = ownership.claimSuperOwner(OTHER_NUMBER, { eligible: true });
        assert.strictEqual(res.established, false);
        assert.strictEqual(res.existing, SUPER_NUMBER);
        assert.strictEqual(ownership.getSuperOwner(), SUPER_NUMBER); // unchanged
        // even a later claim with the SAME value reports established=false
        // (it is already locked, not re-established)
        const res2 = ownership.claimSuperOwner(SUPER_NUMBER, { eligible: true });
        assert.strictEqual(res2.established, false);
    });

    await test('after establishment: only the persisted Super Owner passes platform checks', () => {
        const configBase = require('../config');
        const legacyNumber = String(configBase.ownerNumber[0]).replace(/\D/g, '');
        assert.strictEqual(ownership.isPlatformOwner(jid(SUPER_NUMBER)), true);
        // hardcoded config numbers LOSE platform authority after establishment
        assert.strictEqual(ownership.isPlatformOwner(jid(legacyNumber)), false);
        assert.strictEqual(ownership.isSuperOwner(jid(SUPER_NUMBER)), true);
        assert.strictEqual(ownership.isSuperOwner(jid(OTHER_NUMBER)), false);
    });

    await test('startup indicator: current session is/ is-not the Super Owner', () => {
        assert.strictEqual(ownership.superOwnerStatusFor(SUPER_NUMBER), '✅');
        assert.strictEqual(ownership.superOwnerStatusFor(OTHER_NUMBER), '❌');
        assert.strictEqual(ownership.superOwnerStatusFor(`${SUPER_NUMBER}:12@s.whatsapp.net`), '✅');
    });

    await test('handler owner checks: Super Owner passes isOwner; legacy numbers keep session-level rights', () => {
        const h = require('../handler');
        const configBase = require('../config');
        const legacyNumber = String(configBase.ownerNumber[0]).replace(/\D/g, '');
        assert.strictEqual(h.isOwner(jid(SUPER_NUMBER)), true);   // super owner controls everything
        assert.strictEqual(h.isOwner(jid(legacyNumber)), true);   // session-level owner list still works
        assert.strictEqual(h.isPlatformOwner(jid(SUPER_NUMBER)), true);
        assert.strictEqual(h.isPlatformOwner(jid(legacyNumber)), false); // lost platform authority
        assert.strictEqual(h.isSuperOwner(jid(SUPER_NUMBER)), true);
        assert.strictEqual(h.isOwner(jid(OTHER_NUMBER)), false);
    });

    await test('platform settings live in the anchor DB, not in bot databases', async () => {
        const alpha = anchorDb.registerBotDatabase('alpha');
        await alpha.ready;
        // facade always resolves the anchor, even inside a bot context
        const { runInBot } = require('../utils/botContext');
        let seen = null;
        await runInBot('alpha', () => { seen = anchorDb.getPlatformSetting('superOwner'); });
        assert.strictEqual(seen, SUPER_NUMBER);
        // the bot's own database never holds the platform value
        assert.strictEqual(alpha.getPlatformSetting('superOwner'), null);
    });

    await test('.addbot command is platform-gated (superOwnerOnly, not ownerOnly)', () => {
        const addbotCmd = require('../commands/owner/addbot');
        assert.strictEqual(addbotCmd.superOwnerOnly, true);
        assert.strictEqual(addbotCmd.ownerOnly, undefined);
    });

    console.log('\n[17] .superowner diagnostic command');
    const soCmd = require('../commands/owner/superowner');

    await test('superowner command: the Super Owner sees ✅ (number never displayed)', async () => {
        let replyText = '';
        const extra = { sender: `${SUPER_NUMBER}@s.whatsapp.net`, reply: async (t) => { replyText = t; } };
        await soCmd.execute({}, {}, [], extra);
        assert.ok(replyText.includes('✅'));
        assert.ok(replyText.includes('Super Owner'));
        assert.ok(replyText.includes(SUPER_NUMBER)); // sender's OWN number is fine
        assert.ok(!replyText.includes('234899999999')); // nothing else leaks
    });

    await test('superowner command: a normal session sees ❌', async () => {
        let replyText = '';
        const extra = { sender: `${OTHER_NUMBER}@s.whatsapp.net`, reply: async (t) => { replyText = t; } };
        await soCmd.execute({}, {}, [], extra);
        assert.ok(replyText.includes('❌'));
        assert.ok(replyText.includes('NOT the Super Owner'));
    });

    await test('superowner command is deliberately ungated (test/diagnostic)', () => {
        assert.strictEqual(soCmd.ownerOnly, undefined);
        assert.strictEqual(soCmd.superOwnerOnly, undefined);
    });

    console.log('\n[18] platform gate regression: no fromMe bypass for superOwnerOnly');
    const h2 = require('../handler');

    await test('fromMe from a NON-Super-Owner account does NOT pass the platform gate', () => {
        // Reproduces the real bug: the 909 account holder messaged the bot in
        // its own "Message yourself" chat (msg.key.fromMe = true). Platform
        // authority must stay number-based — fromMe must NOT auto-grant it.
        const msg = { key: { fromMe: true, remoteJid: `${OTHER_NUMBER}@s.whatsapp.net` } };
        const resolvedSender = `${OTHER_NUMBER}@s.whatsapp.net`;
        assert.strictEqual(h2.platformGatePassed(msg, resolvedSender), false);
    });

    await test('the Super Owner passes the platform gate even without fromMe', () => {
        const msg = { key: { fromMe: false, remoteJid: 'g@g.us' } };
        const resolvedSender = `${SUPER_NUMBER}@s.whatsapp.net`;
        assert.strictEqual(h2.platformGatePassed(msg, resolvedSender), true);
    });

    await test('session-level isOwner still honors fromMe semantics (unchanged behavior)', () => {
        // The fromMe shortcut remains for SESSION-level owner checks only.
        // (isOwner itself is number-based; the fromMe OR lives at the gate
        // sites. This test pins the number-based behavior for non-owners.)
        assert.strictEqual(h2.isOwner(`${OTHER_NUMBER}@s.whatsapp.net`), false);
        assert.strictEqual(h2.isOwner(`${SUPER_NUMBER}@s.whatsapp.net`), true);
    });

    console.log('\n[19] addbot flow — quotas, registry removal, buttons, status messages');
    const flow = require('../utils/addbotFlow');

    await test('parseMaxSessions: default 10, rejects invalid values', () => {
        assert.strictEqual(flow.parseMaxSessions(undefined), 10);
        assert.strictEqual(flow.parseMaxSessions('25'), 25);
        assert.strictEqual(flow.parseMaxSessions('0'), 10);
        assert.strictEqual(flow.parseMaxSessions('abc'), 10);
    });

    await test('checkAddQuota: allows under the cap, blocks at the global limit', () => {
        const registry = [{ phone: '1' }, { phone: '2' }];
        assert.strictEqual(flow.checkAddQuota({ registry, runningPhones: [], phone: '3', max: '10' }).ok, true);
        const blocked = flow.checkAddQuota({ registry, runningPhones: [], phone: '3', max: '2' });
        assert.strictEqual(blocked.ok, false);
        assert.strictEqual(blocked.reason, 'quota');
        assert.strictEqual(blocked.limit, 2);
    });

    await test('checkAddQuota: blocks the 5th device on the same WhatsApp number', () => {
        const registry = [
            { phone: '2348154853640' }, { phone: '2348154853640' },
            { phone: '2348154853640' }, { phone: '2348154853640' },
        ];
        const blocked = flow.checkAddQuota({ registry, runningPhones: [], phone: '2348154853640', max: '10' });
        assert.strictEqual(blocked.ok, false);
        assert.strictEqual(blocked.reason, 'device-limit');
        assert.strictEqual(blocked.limit, 4);
    });

    await test('removeRegistryEntry: by phone, by id, unknown — caller array untouched', () => {
        const registry = [
            { sessionId: '', phone: '2348154853640' },
            { sessionId: 'JUNE-MD:~x', phone: '2348165321909', id: 'client-one' },
        ];
        const byPhone = flow.removeRegistryEntry(registry, '2348154853640');
        assert.strictEqual(byPhone.ok, true);
        assert.strictEqual(byPhone.registry.length, 1);
        const byId = flow.removeRegistryEntry(registry, 'client-one');
        assert.strictEqual(byId.ok, true);
        assert.strictEqual(byId.removed.phone, '2348165321909');
        const unknown = flow.removeRegistryEntry(registry, 'nope');
        assert.strictEqual(unknown.ok, false);
        assert.strictEqual(unknown.reason, 'unknown');
        assert.strictEqual(registry.length, 2); // untouched
    });

    await test('buildCodeMessage: code, buttons with ids + copy_code, cancel button', () => {
        const payload = flow.buildCodeMessage({ code: 'ABCD-1234', attempt: 2, max: 5, phone: '2348154853640', botId: 'b1' });
        assert.ok(payload.text.includes('ABCD-1234'));
        assert.ok(payload.text.includes('(2/5)'));
        assert.strictEqual(payload.buttons.length, 2);
        const copy = JSON.parse(payload.buttons[0].buttonParamsJson);
        const cancel = JSON.parse(payload.buttons[1].buttonParamsJson);
        assert.strictEqual(copy.id, 'addbot_copy_b1');
        assert.strictEqual(copy.copy_code, 'ABCD-1234');
        assert.strictEqual(cancel.id, 'addbot_cancel_b1');
    });

    await test('parseAddbotButton: copy / cancel / garbage', () => {
        assert.deepStrictEqual(flow.parseAddbotButton('addbot_copy_b1'), { action: 'copy', botId: 'b1' });
        assert.deepStrictEqual(flow.parseAddbotButton('addbot_cancel_xyz'), { action: 'cancel', botId: 'xyz' });
        assert.strictEqual(flow.parseAddbotButton('btn_menu'), null);
        assert.strictEqual(flow.parseAddbotButton(''), null);
    });

    await test('buildStatusMessage: terminal states carry phone + next steps', () => {
        assert.ok(flow.buildStatusMessage('connected', '2348154853640').includes('✅'));
        assert.ok(flow.buildStatusMessage('pairing-limit', '2348154853640').includes('.repairbot 2348154853640'));
        assert.ok(flow.buildStatusMessage('cancelled', '2348154853640').includes('❌'));
        assert.ok(flow.buildStatusMessage('failed', '2348154853640').includes('❌'));
    });

    console.log('\n[20] .delbot / .bots / .repairbot commands');
    const delbotCmd = require('../commands/owner/delbot');
    const botsCmd = require('../commands/owner/bots');
    const repairbotCmd = require('../commands/owner/repairbot');

    await test('delbot: valid identifier routes to the removal hook with ✅ reaction', async () => {
        const oldHook = global.__JUNE_REMOVE_SESSION;
        let calledWith = null;
        let replies = [];
        let reactions = [];
        global.__JUNE_REMOVE_SESSION = (id) => { calledWith = id; return Promise.resolve({ ok: true, removed: { phone: '2348165321909' }, persisted: true }); };
        const extra = { reply: async (t) => { replies.push(t); }, react: async (e) => { reactions.push(e); } };
        await delbotCmd.execute({}, { key: { remoteJid: 'c@g.us' } }, ['2348165321909'], extra);
        assert.strictEqual(calledWith, '2348165321909');
        assert.ok(replies[0].includes('Session removed'));
        assert.deepStrictEqual(reactions, ['✅']);
        global.__JUNE_REMOVE_SESSION = oldHook;
    });

    await test('delbot: unknown session shows a clear error', async () => {
        const oldHook = global.__JUNE_REMOVE_SESSION;
        let replies = [];
        global.__JUNE_REMOVE_SESSION = () => Promise.resolve({ ok: false, reason: 'unknown' });
        const extra = { reply: async (t) => { replies.push(t); }, react: async () => {} };
        await delbotCmd.execute({}, { key: { remoteJid: 'c@g.us' } }, ['nope'], extra);
        assert.ok(replies[0].includes('No session matches'));
        global.__JUNE_REMOVE_SESSION = oldHook;
    });

    await test('delbot: missing identifier shows usage', async () => {
        let replies = [];
        const extra = { reply: async (t) => { replies.push(t); } };
        await delbotCmd.execute({}, { key: { remoteJid: 'c@g.us' } }, [], extra);
        assert.ok(replies[0].includes('Usage'));
    });

    await test('bots: renders the fleet snapshot with states and pairing info', async () => {
        const oldHook = global.__JUNE_SESSIONS_SNAPSHOT;
        global.__JUNE_SESSIONS_SNAPSHOT = () => [
            { id: 'a', name: 'June X 640', state: 'connected', account: '+234****640', connectedAt: Date.now(), pairingAttempts: 0, pairingExhausted: false },
            { id: 'b', name: 'June X 909', state: 'needs-login', account: null, connectedAt: null, pairingAttempts: 5, pairingExhausted: true },
        ];
        let replies = [];
        const extra = { reply: async (t) => { replies.push(t); } };
        await botsCmd.execute({}, {}, [], extra);
        const text = replies[0];
        assert.ok(text.includes('June X 640'));
        assert.ok(text.includes('CONNECTED'));
        assert.ok(text.includes('June X 909'));
        assert.ok(text.includes('NEEDS-LOGIN'));
        assert.ok(text.includes('pairing limit reached'));
        global.__JUNE_SESSIONS_SNAPSHOT = oldHook;
    });

    await test('bots: empty fleet shows a placeholder', async () => {
        const oldHook = global.__JUNE_SESSIONS_SNAPSHOT;
        global.__JUNE_SESSIONS_SNAPSHOT = () => [];
        let replies = [];
        const extra = { reply: async (t) => { replies.push(t); } };
        await botsCmd.execute({}, {}, [], extra);
        assert.ok(replies[0].includes('No sessions registered'));
        global.__JUNE_SESSIONS_SNAPSHOT = oldHook;
    });

    await test('repairbot: routes to the hook WITH chat meta (code flows back here)', async () => {
        const oldHook = global.__JUNE_REPAIR_SESSION;
        const { runInBot } = require('../utils/botContext');
        let calledWith = null;
        let calledMeta = null;
        let reactions = [];
        global.__JUNE_REPAIR_SESSION = (id, meta) => { calledWith = id; calledMeta = meta; return Promise.resolve({ ok: true, id: 'b1' }); };
        const msg = { key: { remoteJid: 'chat@g.us', id: 'MSGID2' } };
        const extra = { reply: async () => {}, react: async (e) => { reactions.push(e); } };
        await runInBot('via-bot', () => repairbotCmd.execute({}, msg, ['2348165321909'], extra));
        assert.strictEqual(calledWith, '2348165321909');
        assert.strictEqual(calledMeta.chatJid, 'chat@g.us');
        assert.strictEqual(calledMeta.viaBotId, 'via-bot');
        assert.deepStrictEqual(reactions, ['⏳']);
        global.__JUNE_REPAIR_SESSION = oldHook;
    });

    await test('repairbot: already-online session is reported, not repaired', async () => {
        const oldHook = global.__JUNE_REPAIR_SESSION;
        let replies = [];
        global.__JUNE_REPAIR_SESSION = () => Promise.resolve({ ok: false, reason: 'online', id: 'b1' });
        const extra = { reply: async (t) => { replies.push(t); }, react: async () => {} };
        await repairbotCmd.execute({}, { key: { remoteJid: 'c@g.us' } }, ['b1'], extra);
        assert.ok(replies[0].includes('already connected'));
        global.__JUNE_REPAIR_SESSION = oldHook;
    });

    console.log('\n──────────────────────────────────────────');
    console.log(`  ${passed} passed, ${failed} failed`);
    if (failed > 0) {
        console.log('  FAILURES:');
        for (const f of failures) console.log(`   - ${f.name}: ${f.error.message}`);
        process.exit(1);
    }

    await db.shutdownAllDatabases();
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
