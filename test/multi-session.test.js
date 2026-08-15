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

    console.log('\n[11] hot-add / hot-remove plumbing');
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
