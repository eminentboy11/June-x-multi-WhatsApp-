'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { BotInstance, SessionManager } = require('../utils/core/sessionManager');
const { requestPairingCodeForCycle } = require('../utils/core/pairingLifecycle');

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
        maxAttempts: 5,
        stabilizeMs: 0,
        ...options,
    });
}

test('A: normal cycle progresses 1/5 through 5/5 and parks', async () => {
    const calls = { count: 0 };
    const bot = makeBot();
    const socket = makeSocket(calls);
    bot.sock = socket;

    const attempts = [];
    for (let i = 0; i < 5; i += 1) {
        const result = await request(bot, socket);
        attempts.push(result.attempt);
    }

    assert.deepEqual(attempts, [1, 2, 3, 4, 5]);
    assert.equal(calls.count, 5);
    assert.equal(bot.pairingAttempts, 5);
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

test('D: a sixth attempt never calls socket.requestPairingCode', async () => {
    const calls = { count: 0 };
    const bot = makeBot();
    const socket = makeSocket(calls);
    bot.sock = socket;
    for (let i = 0; i < 5; i += 1) await request(bot, socket);

    const sixth = await request(bot, socket);
    assert.equal(sixth.ok, false);
    assert.equal(sixth.reason, 'exhausted');
    assert.equal(calls.count, 5);
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

test('H: repair terminates the old cycle and starts a new cycle at 1/5', async () => {
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

test('I: concurrent triggers reserve no more than five total requests', async () => {
    const calls = { count: 0 };
    const bot = makeBot();
    const socket = makeSocket(calls);
    bot.sock = socket;

    const results = await Promise.all(
        Array.from({ length: 20 }, () => request(bot, socket))
    );
    const successful = results.filter((result) => result.ok);

    assert.equal(calls.count, 5);
    assert.equal(successful.length, 5);
    assert.deepEqual(successful.map((result) => result.attempt).sort(), [1, 2, 3, 4, 5]);
    assert.equal(bot.pairingExhausted, true);
    assert.equal(bot.botState, 'needs-login');
});
