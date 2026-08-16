/**
 * Bot Context — AsyncLocalStorage plumbing for multi-session June X.
 *
 * The entire codebase (commands, handler, database facade, config) resolves the
 * "current bot" through this module. When a WhatsApp message is processed for
 * bot X, the handler runs inside `runInBot(X, ...)` — every database/config
 * read made inside that call tree is automatically scoped to bot X.
 *
 * AsyncLocalStorage propagates across async/await AND timer callbacks
 * (setTimeout/setImmediate/setInterval), so delayed command logic keeps its
 * bot context.
 *
 * When no context is active (startup, maintenance timers started at module
 * scope, etc.), the DEFAULT bot id is used as a safe fallback.
 */

'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');

const DEFAULT_BOT_ID = process.env.JUNE_BOT_ID || process.env.BOT_ID || process.env.OWNER_NUMBER || 'default';

const als = new AsyncLocalStorage();

/**
 * Run `fn` (sync or async) inside the context of the given bot.
 * Returns whatever fn returns (promise-aware).
 */
function runInBot(botId, fn) {
    const store = { botId: String(botId || DEFAULT_BOT_ID) };
    return als.run(store, fn);
}

/**
 * The bot id for the currently executing context (defaults to DEFAULT_BOT_ID).
 */
function getCurrentBotId() {
    return als.getStore()?.botId || DEFAULT_BOT_ID;
}

/**
 * Returns a Map-like object whose contents are scoped per bot.
 *
 * Usage sites keep working unchanged: `cache.get(k)`, `cache.set(k, v)`,
 * `cache.has(k)`, `cache.delete(k)`, `cache.clear()`, `cache.size`, plus
 * iteration (for..of, spread, Object.entries-style helpers).
 *
 * @param {() => Map} factory  creates a fresh map per bot on first use
 */
function scopedMap(factory = () => new Map()) {
    const stores = new Map(); // botId -> Map

    const resolve = () => {
        const botId = getCurrentBotId();
        let store = stores.get(botId);
        if (!store) {
            store = factory();
            stores.set(botId, store);
        }
        return store;
    };

    return new Proxy({}, {
        get(_t, prop) {
            if (prop === 'clearAllBots') {
                return () => { for (const s of stores.values()) s.clear(); };
            }
            if (prop === 'pruneAllBots') {
                return (fn) => { for (const s of stores.values()) fn(s); };
            }
            if (prop === 'forEachBot') {
                return (fn) => { for (const [botId, s] of stores) fn(s, botId); };
            }
            const store = resolve();
            const value = store[prop];
            return typeof value === 'function' ? value.bind(store) : value;
        },
        set(_t, prop, value) {
            const store = resolve();
            store[prop] = value;
            return true;
        },
        has(_t, prop) {
            return prop in resolve();
        },
        deleteProperty(_t, prop) {
            return delete resolve()[prop];
        },
        ownKeys() {
            const store = resolve();
            return [...store.keys()];
        },
        getOwnPropertyDescriptor(_t, prop) {
            const store = resolve();
            if (!store.has(prop)) return undefined;
            return { enumerable: true, configurable: true, writable: true, value: store.get(prop) };
        },
    });
}

/**
 * Returns a per-bot scoped cache for scalar values (like { value, expiry }).
 * `scopedState('_arCache')` returns an object whose properties are stored
 * per bot. Usage:
 *
 *   const cache = scopedState('autoReact');
 *   cache.value  = {...};          // set for the current bot
 *   cache.expiry = Date.now();
 *   if (cache.value && Date.now() < cache.expiry) ...
 */
function scopedState(key) {
    const stores = new Map(); // botId -> state object
    const resolve = () => {
        const botId = getCurrentBotId();
        let state = stores.get(botId);
        if (!state) {
            state = {};
            stores.set(botId, state);
        }
        return state;
    };
    return new Proxy({}, {
        get(_t, prop) {
            if (prop === 'clearAllBots') {
                return () => stores.clear();
            }
            return resolve()[prop];
        },
        set(_t, prop, value) {
            resolve()[prop] = value;
            return true;
        },
        has(_t, prop) {
            return prop in resolve();
        },
        deleteProperty(_t, prop) {
            return delete resolve()[prop];
        },
        ownKeys() {
            return Reflect.ownKeys(resolve());
        },
        getOwnPropertyDescriptor(_t, prop) {
            return Object.getOwnPropertyDescriptor(resolve(), prop);
        },
    });
}

/**
 * Execute `fn` for every registered bot id, inside that bot's context.
 * Used for shutdown flushes and maintenance that must touch all bots.
 */
function forEachBot(botIds, fn) {
    return Promise.allSettled(
        botIds.map((botId) => Promise.resolve().then(() => runInBot(botId, () => fn(botId))))
    );
}

module.exports = {
    DEFAULT_BOT_ID,
    runInBot,
    getCurrentBotId,
    scopedMap,
    scopedState,
    forEachBot,
};
