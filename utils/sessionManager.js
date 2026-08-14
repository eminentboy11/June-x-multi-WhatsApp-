/**
 * Session Manager — multi-session core for June X.
 *
 * Owns the registry of bot sessions and all per-bot runtime state that the
 * single-session build kept in process globals (socket, reconnect counters,
 * intervals, message store, status queues…).
 *
 * A session is registered from:
 *   1. `JUNE_SESSIONS` env — JSON array or { sessions: [...] }
 *   2. `sessions.json` at the project root — same shape
 *   3. legacy `SESSION_ID` / .env — one session, id = JUNE_BOT_ID fallback
 *
 * Entry shape:
 *   { id: 'main', name: 'June Main', phone: '2547...', sessionId: 'JUNE-MD:~...' }
 *
 * The actual Baileys boot lives in index.js (startBotSocket); the manager
 * receives it via setBootFn so it can be unit-tested without network access.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { DEFAULT_BOT_ID } = require('./botContext');

const SESSIONS_FILE = path.join(process.cwd(), 'sessions.json');

function defaultSessionDir(botId) {
    // Legacy single-session installs keep their existing folder so existing
    // auth files are picked up without re-pairing.
    return botId === DEFAULT_BOT_ID
        ? path.join(process.cwd(), 'session')
        : path.join(process.cwd(), 'sessions', String(botId));
}

class BotInstance {
    constructor(entry = {}) {
        this.id = String(entry.id || DEFAULT_BOT_ID);
        this.name = String(entry.name || `Session ${this.id}`);
        this.phone = String(entry.phone || '').replace(/[^0-9]/g, '');
        this.sessionId = String(entry.sessionId || '').trim();
        this.interactive = Boolean(entry.interactive) || this.id === DEFAULT_BOT_ID;

        // Paths
        this.sessionDir = entry.sessionDir || defaultSessionDir(this.id);
        this.credsPath = path.join(this.sessionDir, 'creds.json');

        // Per-bot database + config + adapters (wired by index.js at boot)
        this.db = null;
        this.config = null;
        this.pg = null;
        this.mongo = null;

        // Connection state (formerly process globals)
        this.sock = null;
        this.store = null;            // per-bot in-memory message store
        this.authState = null;
        this.botState = 'disconnected'; // disconnected | connecting | connected | needs-login
        this.connectedAt = null;
        this.isBotConnected = false;
        this.connectDebounceTimeout = null;
        this.errorRetryCount = 0;
        this.isReconnecting = false;
        this._consecutive500Count = 0;
        this._conflictCount = 0;
        this._lastConflictLogTime = 0;
        this._suppressedConflictCount = 0;
        this._conflictSummaryTimer = null;
        this._reconnectTimer = null;
        this._shutdownRequested = false;
        this._shutdownPromise = null;
        this.startupReportPrinted = false;
        this.startupStartedAt = Date.now();
        this.welcomeSent = false;
        this.newsletters = [];
        this.groupInvites = [];

        // Per-bot intervals (cleared on stop / reconnect)
        this._activeIntervals = [];

        // Per-bot runtime stores
        this.processedMessages = new Set();
        this.statusStore = new Map();
        this.presenceStore = {};
        this._sReactQueue = [];
        this._sReactQueueRunning = false;
        this._sReactedIds = new Set();

        // Pairing / login
        this._pairingCodeRequested = false;
        this.loginMethod = null;
        this._lastSessionExport = 0;
        this._bootstrapRetries = 0;
        this._fallbackToPairing = false; // sessionId+phone: auto pairing fallback active

        // Error info for dashboard
        this.lastError = null;
        this.accountNumber = null;
    }

    get status() {
        return {
            id: this.id,
            name: this.name,
            state: this.botState,
            connected: this.botState === 'connected',
            account: this.accountNumber
                ? `+${String(this.accountNumber).slice(0, 3)}******${String(this.accountNumber).slice(-3)}`
                : null,
            connectedAt: this.connectedAt,
            error: this.lastError,
        };
    }
}

class SessionManager {
    constructor() {
        this.bots = new Map(); // id -> BotInstance
        this.bootFn = null;    // async (bot) => sock
    }

    setBootFn(fn) {
        this.bootFn = fn;
    }

    register(entry) {
        const bot = entry instanceof BotInstance ? entry : new BotInstance(entry);
        if (!this.bots.has(bot.id)) this.bots.set(bot.id, bot);
        return this.bots.get(bot.id);
    }

    get(id) {
        return this.bots.get(String(id)) || null;
    }

    list() {
        return [...this.bots.values()];
    }

    ids() {
        return [...this.bots.keys()];
    }

    defaultBot() {
        return this.get(DEFAULT_BOT_ID);
    }

    snapshot() {
        return this.list().map((bot) => bot.status);
    }

    async start(id) {
        const bot = this.get(id);
        if (!bot) throw new Error(`Unknown session: ${id}`);
        if (!this.bootFn) throw new Error('SessionManager.bootFn is not configured');
        if (bot.sock && bot.botState !== 'needs-login') return bot;
        bot.botState = 'connecting';
        bot._shutdownRequested = false;
        try {
            bot.sock = await this.bootFn(bot);
            return bot;
        } catch (error) {
            bot.lastError = String(error?.message || error);
            bot.botState = 'needs-login';
            throw error;
        }
    }

    async startAll() {
        for (const bot of this.list()) {
            try {
                await this.start(bot.id);
            } catch (error) {
                bot.lastError = String(error?.message || error);
            }
        }
    }

    async stop(id) {
        const bot = this.get(id);
        if (!bot) return;
        bot._shutdownRequested = true;
        if (bot._reconnectTimer) {
            clearTimeout(bot._reconnectTimer);
            bot._reconnectTimer = null;
        }
        for (const interval of bot._activeIntervals || []) clearInterval(interval);
        bot._activeIntervals = [];
        const sock = bot.sock;
        if (sock) {
            try { sock.ev?.removeAllListeners?.(); } catch (_) {}
            try { sock.ws?.close?.(); } catch (_) {}
            try { sock.end?.(new Error('session stopped')); } catch (_) {}
        }
        bot.sock = null;
        bot.isBotConnected = false;
        bot.botState = 'disconnected';
    }

    async stopAll() {
        for (const bot of this.list()) await this.stop(bot.id);
    }
}

// ─── Registry parsing ─────────────────────────────────────────────────────────

function parseSessionsJson(raw) {
    if (!raw || !String(raw).trim()) return null;
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
        if (parsed && Array.isArray(parsed.sessions)) return parsed.sessions;
        if (parsed && typeof parsed === 'object') return [parsed];
    } catch (_) {}
    return null;
}

function loadRegistryFromFile() {
    try {
        if (!fs.existsSync(SESSIONS_FILE)) return null;
        return parseSessionsJson(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    } catch (_) {
        return null;
    }
}

function loadRegistryFromEnv() {
    return parseSessionsJson(process.env.JUNE_SESSIONS);
}

function buildLegacyEntry() {
    const sessionId = String(process.env.SESSION_ID || '').trim();
    const phone = String(process.env.JUNE_PAIRING_NUMBER || '').trim();
    return {
        id: DEFAULT_BOT_ID,
        name: process.env.JUNE_BOT_NAME || 'June X (main)',
        phone,
        sessionId,
        interactive: true,
    };
}

function loadSessionRegistry() {
    // Priority: JUNE_SESSIONS env > sessions.json > legacy SESSION_ID.
    const entries = loadRegistryFromEnv() || loadRegistryFromFile();
    if (entries && entries.length > 0) {
        const clean = entries
            .filter((entry) => entry && (entry.id || entry.sessionId || entry.phone))
            .map((entry) => ({ ...entry }));
        // A registry entry with the default bot id REPLACES the legacy env
        // entry; otherwise the legacy SESSION_ID still gets its own session.
        const hasDefault = clean.some((entry) => String(entry.id) === DEFAULT_BOT_ID);
        if (!hasDefault && (process.env.SESSION_ID || process.env.JUNE_PAIRING_NUMBER)) {
            clean.push(buildLegacyEntry());
        }
        return clean;
    }
    return [buildLegacyEntry()];
}

module.exports = {
    SessionManager,
    BotInstance,
    loadSessionRegistry,
    parseSessionsJson,
    SESSIONS_FILE,
    DEFAULT_BOT_ID,
};
