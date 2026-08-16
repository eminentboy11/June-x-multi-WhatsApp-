'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    BotInstance,
    SessionManager,
    parsePairingMaxAttempts,
    requestPairingCodeForCycle,
} = require('../utils/core/sessionManager');

function makeBot(id = 'pairing-test') {
    const bot = new BotInstance({ id, phone: '2348000000000' });
    bot.startPairingCycle('test');
    bot.botState = 'connecting';
    return bot;
}

function makeSocket(calls, prefix = 'CODE') {
    return {
        ev: { removeAllListeners() {} },
        ws: { close() {} },
        end() {},
        async requestPairingCode() {
            calls.count += 1;
            return `${prefix}${calls.count}`;
        },
    };
}

async function request(bot, socket, options = {}) {
    return requestPairingCodeForCycle({
        bot,
        socket,
        maxAttempts: 3,
        stabilizeMs: 0,
        ...options,
    });
}

test('A: normal cycle progresses 1/3 through 3/3 and parks', async () => {
    const calls = { count: 0 };
    const bot = makeBot();
    const socket = makeSocket(calls);
    bot.sock = socket;

    const attempts = [];
    for (let i = 0; i < 3; i += 1) {
        const result = await request(bot, socket);
        attempts.push(result.attempt);
    }

    assert.deepEqual(attempts, [1, 2, 3]);
    assert.equal(calls.count, 3);
    assert.equal(bot.pairingAttempts, 3);
    assert.equal(bot.pairingExhausted, true);
    assert.equal(bot.botState, 'needs-login');
});

test('B: internal socket reconnect preserves the current counter and generation', async () => {
    const calls = { count: 0 };
    const bot = makeBot();
    const generation = bot.getPairingGeneration();
    const first = makeSocket(calls, 'A');
    bot.sock = first;
    assert.equal((await request(bot, first)).attempt, 1);

    const replacement = makeSocket(calls, 'B');
    bot.sock = replacement;
    assert.equal(bot.pairingAttempts, 1);
    assert.equal(bot.getPairingGeneration(), generation);
    assert.equal((await request(bot, replacement)).attempt, 2);
});

test('C: repeated socket replacements do not reset the cycle', async () => {
    const calls = { count: 0 };
    const bot = makeBot();
    const generation = bot.getPairingGeneration();
    let socket = makeSocket(calls, 'A');
    bot.sock = socket;
    assert.equal((await request(bot, socket)).attempt, 1);

    for (let i = 0; i < 3; i += 1) {
        socket = makeSocket(calls, `R${i}`);
        bot.sock = socket;
        assert.equal(bot.pairingAttempts, 1);
        assert.equal(bot.getPairingGeneration(), generation);
    }
    assert.equal((await request(bot, socket)).attempt, 2);
});

test('D: a fourth attempt never calls socket.requestPairingCode', async () => {
    const calls = { count: 0 };
    const bot = makeBot();
    const socket = makeSocket(calls);
    bot.sock = socket;
    for (let i = 0; i < 3; i += 1) await request(bot, socket);

    const fourth = await request(bot, socket);
    assert.equal(fourth.ok, false);
    assert.equal(fourth.reason, 'exhausted');
    assert.equal(calls.count, 3);
});

test('E: an old socket is rejected before it can request or deliver a code', async () => {
    const calls = { count: 0 };
    const delivered = [];
    const bot = makeBot();
    const oldSocket = makeSocket(calls, 'OLD');
    bot.sock = oldSocket;

    let release;
    const waiting = request(bot, oldSocket, {
        stabilizeMs: 1,
        delay: () => new Promise((resolve) => { release = resolve; }),
        onCode: async (code) => delivered.push(code),
    });
    await new Promise((resolve) => setImmediate(resolve));

    bot.sock = makeSocket(calls, 'NEW');
    release();
    const result = await waiting;
    assert.equal(result.reason, 'inactive-or-stale');
    assert.equal(calls.count, 0);
    assert.deepEqual(delivered, []);
});

test('F: successful connection invalidates queued and in-flight deliveries', async () => {
    const calls = { count: 0 };
    const delivered = [];
    const bot = makeBot();
    const socket = makeSocket(calls);
    bot.sock = socket;
    bot._lastPairingCode = 'OLD-CODE';

    let release;
    const queued = request(bot, socket, {
        stabilizeMs: 1,
        delay: () => new Promise((resolve) => { release = resolve; }),
        onCode: async (code) => delivered.push(code),
    });
    await new Promise((resolve) => setImmediate(resolve));

    const generation = bot.getPairingGeneration();
    bot.terminatePairingCycle('connected');
    bot.botState = 'connected';
    release();

    const result = await queued;
    assert.equal(result.ok, false);
    assert.equal(calls.count, 0);
    assert.deepEqual(delivered, []);
    assert.equal(bot.hasActivePairingCycle(), false);
    assert.ok(bot.getPairingGeneration() > generation);
    assert.equal(bot._lastPairingCode, null);
    assert.equal(bot.pairingAttempts, 0);
    assert.equal(bot.pairingExhausted, false);
});

test('F2: a response from a request already in flight is never delivered after success', async () => {
    const bot = makeBot('in-flight');
    const delivered = [];
    let resolveCode;
    let calls = 0;
    const socket = {
        async requestPairingCode() {
            calls += 1;
            return new Promise((resolve) => { resolveCode = resolve; });
        },
    };
    bot.sock = socket;

    const pending = request(bot, socket, { onCode: async (code) => delivered.push(code) });
    await new Promise((resolve) => setImmediate(resolve));
    bot.terminatePairingCycle('connected');
    bot.botState = 'connected';
    resolveCode('LATE-CODE');

    const result = await pending;
    assert.equal(calls, 1);
    assert.equal(result.reason, 'stale-after-request');
    assert.deepEqual(delivered, []);
});

test('G: session deletion invalidates queued pairing requests', async () => {
    const calls = { count: 0 };
    const manager = new SessionManager();
    const bot = manager.register(new BotInstance({ id: 'delete-me', phone: '2348000000000' }));
    bot.startPairingCycle('addbot');
    bot.botState = 'connecting';
    const socket = makeSocket(calls);
    bot.sock = socket;

    let release;
    const pending = request(bot, socket, {
        stabilizeMs: 1,
        delay: () => new Promise((resolve) => { release = resolve; }),
    });
    await new Promise((resolve) => setImmediate(resolve));
    await manager.remove(bot.id);
    release();

    const result = await pending;
    assert.equal(result.ok, false);
    assert.equal(calls.count, 0);
    assert.equal(manager.get(bot.id), null);
    assert.equal(bot.hasActivePairingCycle(), false);
});

test('H: repair terminates the old cycle and starts a new cycle at 1/3', async () => {
    const calls = { count: 0 };
    const bot = makeBot();
    let socket = makeSocket(calls, 'OLD');
    bot.sock = socket;
    await request(bot, socket);
    const oldGeneration = bot.getPairingGeneration();

    bot.startPairingCycle('repairbot');
    assert.notEqual(bot.getPairingGeneration(), oldGeneration);
    assert.equal(bot.pairingAttempts, 0);
    assert.equal(bot.pairingExhausted, false);

    socket = makeSocket(calls, 'REPAIR');
    bot.sock = socket;
    assert.equal((await request(bot, socket)).attempt, 1);
});

test('I: concurrent triggers reserve no more than three total requests', async () => {
    const calls = { count: 0 };
    const bot = makeBot();
    const socket = makeSocket(calls);
    bot.sock = socket;

    const results = await Promise.all(
        Array.from({ length: 20 }, () => request(bot, socket))
    );
    const successful = results.filter((result) => result.ok);

    assert.equal(calls.count, 3);
    assert.equal(successful.length, 3);
    assert.deepEqual(successful.map((result) => result.attempt).sort(), [1, 2, 3]);
    assert.equal(bot.pairingExhausted, true);
    assert.equal(bot.botState, 'needs-login');
});

test('J: requests use the hard-coded JUNEXBOT custom pairing code', async () => {
    const bot = makeBot('custom-code');
    const received = [];
    const socket = {
        async requestPairingCode(phone, customCode) {
            received.push({ phone, customCode });
            return customCode;
        },
    };
    bot.sock = socket;

    const result = await request(bot, socket, {
        // Mirrors the explicit callback supplied by index.js for both default
        // and hot-added sessions.
        requestCode: (phone) => socket.requestPairingCode(phone, 'JUNEXBOT'),
    });
    assert.equal(result.ok, true);
    assert.deepEqual(received, [{ phone: '2348000000000', customCode: 'JUNEXBOT' }]);
    assert.equal(result.code, 'JUNEXBOT');
});

test('K: configured pairing limits are capped at three', () => {
    assert.equal(parsePairingMaxAttempts(undefined), 3);
    assert.equal(parsePairingMaxAttempts('5'), 3);
    assert.equal(parsePairingMaxAttempts('99'), 3);
    assert.equal(parsePairingMaxAttempts('2'), 2);
});

test('L: compatibility imports share the consolidated core instances', () => {
    assert.equal(require('../utils/sessionManager'), require('../utils/core/sessionManager'));
    assert.equal(require('../utils/addbotFlow'), require('../utils/core/addbotFlow'));
    assert.equal(require('../utils/botContext'), require('../utils/core/botContext'));
});
