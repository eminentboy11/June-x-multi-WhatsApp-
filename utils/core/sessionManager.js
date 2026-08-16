/**
 * Session Manager — multi-session core for June X.
 *
 * Owns the registry of bot sessions and all per-bot runtime state that the
 * single-session build kept in process globals (socket, reconnect counters,
 * intervals, message store, status queues…).
 *
 * A session is registered from the `JUNE_SESSIONS` environment variable —
 * the SOLE session configuration source (JSON array or { sessions: [...] }).
 * The value hot-reloads: index.js watches the .env file for changes to the
 * JUNE_SESSIONS line and reconciles the running sessions live (hot-add /
 * hot-remove) without a restart. With no registry configured, one default
 * session with no credentials boots — exactly the old first-run flow
 * (interactive login menu, or a clear exit message on headless platforms).
 *
 * Entry shape (simple):
 *   { phone: '2547...', sessionId: 'JUNE-MD:~...' }
 * Entry shape (full, optional overrides):
 *   { id: 'main', name: 'June Main', phone: '2547...', sessionId: 'JUNE-MD:~...' }
 *
 * The actual Baileys boot lives in index.js (startBotSocket); the manager
 * receives it via setBootFn so it can be unit-tested without network access.
 */

'use strict';

const path = require('path');
const { DEFAULT_BOT_ID } = require('./botContext');

function defaultSessionDir(botId) {
    // Legacy single-session installs keep their existing folder so existing
    // auth files are picked up without re-pairing.
    return botId === DEFAULT_BOT_ID
        ? path.join(process.cwd(), 'session')
        : path.join(process.cwd(), 'sessions', String(botId));
}

/**
 * Per-session console log-box label.
 *
 * The CMD log box header uses this instead of a static "JUNE ULTRA" label:
 *   sessionLogLabel('2348165321909') -> 'JUNE ULTRA 909'
 *   sessionLogLabel(null)            -> 'JUNE ULTRA ···'
 *
 * @param {string|number} number  the session's WhatsApp number (digits only)
 */
function sessionLogLabel(number) {
    // Accept a bare number, a phone-with-device id (2348...:12) or a full JID
    // (2348...:12@s.whatsapp.net) — always resolve to the phone's last 3 digits.
    const raw = String(number || '').split(':')[0].split('@')[0];
    const digits = raw.replace(/\D/g, '');
    const last3 = digits ? digits.slice(-3).padStart(3, '0') : '···';
    return `JUNE ULTRA ${last3}`;
}

/**
 * Console log prefix for a session-aware log line.
 *
 * Single-session / legacy mode keeps the classic prefix:
 *   sessionLogPrefix(bot, false) -> '[ JUNEX ULTRA ]'
 * In multi-session mode the prefix carries the session's tag — the last 3
 * digits of its WhatsApp number, or the session id before the number is known:
 *   sessionLogPrefix(bot, true)  -> '[ JUNEX ULTRA 909 ]' | '[ JUNEX ULTRA main ]'
 */
function sessionLogPrefix(bot, multiSession) {
    if (bot && multiSession) {
        // Number first (accountNumber/phone), then a numeric id (ids derived
        // from a phone), and only then the raw id (non-numeric ids).
        const digits = String(bot.accountNumber || bot.phone || '').replace(/\D/g, '')
            || String(bot.id || '').replace(/\D/g, '');
        const tag = digits ? digits.slice(-3).padStart(3, '0') : String(bot.id);
        return `[ JUNEX ULTRA ${tag} ]`;
    }
    return '[ JUNEX ULTRA ]';
}

class BotInstance {
    constructor(entry = {}) {
        this.id = String(entry.id || DEFAULT_BOT_ID);
        this.name = String(entry.name || `Session ${this.id}`);
        // Explicit names (from the registry) are applied to the bot's botName;
        // auto-derived names ("June X 640") are display-only.
        this.nameExplicit = Boolean(entry.nameExplicit);
        this.phone = String(entry.phone || '').replace(/[^0-9]/g, '');
        this.sessionId = String(entry.sessionId || '').trim();
        this.interactive = Boolean(entry.interactive) || this.id === DEFAULT_BOT_ID;
        // TRUE only for sessions present at process startup (set by index.js
        // main()). Hot-added sessions never get this flag — and therefore can
        // never establish the deployment Super Owner.
        this.isInitialSession = false;

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
        // `phone` is the CONFIGURED number and is never cleared: it re-arms
        // a fresh pairing cycle after every WhatsApp logout. `_pairingPhone`
        // is the transient target consumed while a pairing cycle is live.
        this._pairingCodeRequested = false;
        this._pairingPhone = null;
        this._lastPairingCode = null; // for .addbot in-chat "Copy Code" button
        this.pairingAttempts = 0;      // codes issued in the current cycle
        this.pairingExhausted = false; // limit reached -> parked as needs-login
        this.loginMethod = null;
        this._lastSessionExport = 0;
        this._bootstrapRetries = 0;
        this._fallbackToPairing = false; // sessionId+phone: auto pairing fallback active

        // Error info for dashboard
        this.lastError = null;
        this.accountNumber = null;
    }

    /**
     * Start a fresh pairing cycle using the CONFIGURED phone. Resets the
     * attempt counter and the exhausted flag so every logout/recovery begins
     * with the full pairing-code budget again.
     */
    armPairingCycle() {
        this._pairingPhone = this.phone || this._pairingPhone || '';
        this.pairingAttempts = 0;
        this.pairingExhausted = false;
        this._pairingCodeRequested = false;
        return this._pairingPhone;
    }

    /**
     * Record that one pairing code was successfully shown to the user.
     * Marks the cycle exhausted when the per-cycle limit is reached.
     */
    notePairingAttempt(maxAttempts) {
        this.pairingAttempts += 1;
        const limit = Math.max(1, Number(maxAttempts) || 5);
        if (this.pairingAttempts >= limit) this.pairingExhausted = true;
        return this.pairingAttempts;
    }

    /**
     * Clear the TRANSIENT pairing state after a successful connection.
     * The configured `phone` is intentionally left intact.
     */
    clearPairingState() {
        this._pairingPhone = null;
        this.pairingAttempts = 0;
        this.pairingExhausted = false;
        this._pairingCodeRequested = false;
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
            pairingAttempts: this.pairingAttempts,
            pairingExhausted: this.pairingExhausted,
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

    /**
     * Hot-remove: stop ONLY this session (socket, intervals, reconnect timers)
     * and drop it from the registry. Every other session stays untouched.
     */
    async remove(id) {
        const bot = this.get(id);
        if (!bot) return false;
        await this.stop(id);
        this.bots.delete(String(id));
        return true;
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

const digitsOnly = (value) => String(value || '').replace(/\D/g, '');

const last3Digits = (value) => {
    const digits = digitsOnly(value);
    return digits ? digits.slice(-3).padStart(3, '0') : '';
};

// Supported session-ID formats (shared by index.js bootstrap logic and the
// .addbot command so validation stays in one place).
const VALID_PREFIXES = ['JUNE-MD:~', 'Ultra-X:~', 'June-Ultra:~', 'June::~'];

const isValidSessionIdFormat = (value) => {
    const sessionId = String(value || '').trim();
    return Boolean(sessionId) && VALID_PREFIXES.some((p) => sessionId.startsWith(p));
};

/**
 * Validate a raw .addbot-style session entry (phone + optional sessionId).
 * Returns { ok: false, reason } or { ok: true, phone, sessionId }.
 */
function validateSessionEntry(entry = {}) {
    const phone = digitsOnly(entry.phone);
    const sessionId = String(entry.sessionId || '').trim();
    if (!phone || phone.length < 7 || phone.length > 15) {
        return { ok: false, reason: 'invalid-phone' };
    }
    if (sessionId && !isValidSessionIdFormat(sessionId)) {
        return { ok: false, reason: 'invalid-sessionId' };
    }
    return { ok: true, phone, sessionId };
}

/**
 * Append a validated entry to a raw registry array, rejecting duplicates
 * (same phone = same storage identity; same sessionId = same credential).
 * Pure helper — the runtime registry mutation and hot-add trigger live in
 * index.js, reusing the existing JUNE_SESSIONS reconciliation pipeline.
 */
function addSessionEntry(registry, entry = {}) {
    const check = validateSessionEntry(entry);
    if (!check.ok) return check;
    const list = Array.isArray(registry) ? registry : [];
    const duplicate = list.some((e) => {
        if (digitsOnly(e.phone) === check.phone) return true;
        const sid = String(e.sessionId || '').trim();
        return Boolean(check.sessionId && sid === check.sessionId);
    });
    if (duplicate) return { ok: false, reason: 'duplicate' };
    return {
        ok: true,
        entry: { sessionId: check.sessionId, phone: check.phone },
        registry: [...list, { sessionId: check.sessionId, phone: check.phone }],
    };
}

/**
 * Normalize raw registry entries into fully-qualified session entries.
 *
 * SIMPLE FORMAT (recommended): just sessionId + phone —
 *   [ { "sessionId": "JUNE-MD:~...", "phone": "2348154853640" } ]
 *
 *   id    → derived from the phone automatically (duplicate numbers get
 *           -2, -3 … suffixes so two sessions may share one number)
 *   name  → derived as "June X <last3>" (e.g. "June X 640")
 *
 * FULL FORMAT (still supported, backward compatible): id + name may be
 * given explicitly — they then act as overrides, and an explicit name is
 * also applied to the bot's botName.
 *
 * Entries with no id, no sessionId AND no phone are dropped (they cannot
 * ever connect).
 */
function normalizeSessionEntries(rawEntries) {
    if (!Array.isArray(rawEntries)) return [];
    const cleaned = rawEntries
        .filter((entry) => entry && typeof entry === 'object')
        .map((entry) => ({ ...entry }))
        .filter((entry) => entry.id || entry.sessionId || entry.phone);
    if (cleaned.length === 0) return [];

    // Count phones first so duplicate numbers can be suffixed in order.
    const phoneCounts = new Map();
    for (const entry of cleaned) {
        const phone = digitsOnly(entry.phone);
        if (phone) phoneCounts.set(phone, (phoneCounts.get(phone) || 0) + 1);
    }

    const usedIds = new Set();
    const usedPhones = new Map(); // phone -> how many times already assigned
    const normalized = [];

    for (const entry of cleaned) {
        const phone = digitsOnly(entry.phone);
        const sessionId = String(entry.sessionId || '').trim();
        const nameExplicit = Boolean(entry.name);

        // 1) id — explicit wins; otherwise derived from the phone; otherwise
        //    the default bot id (legacy fallback).
        let id = String(entry.id || '').trim();
        if (!id && phone) {
            const ordinal = (usedPhones.get(phone) || 0) + 1;
            usedPhones.set(phone, ordinal);
            id = ordinal === 1 ? phone : `${phone}-${ordinal}`;
        } else if (!id) {
            id = DEFAULT_BOT_ID;
        }

        // 2) Dedupe ids — an explicit id may collide with a derived one.
        let candidate = id;
        let suffix = 2;
        while (usedIds.has(candidate)) {
            candidate = `${id}-${suffix}`;
            suffix += 1;
        }
        id = candidate;
        usedIds.add(id);

        // 3) name — explicit wins; otherwise derived from the phone;
        //    otherwise a plain fallback label.
        let name = String(entry.name || '').trim();
        if (!name) {
            const last3 = last3Digits(phone);
            name = last3 ? `June X ${last3}` : `Session ${id}`;
        }

        normalized.push({
            ...entry,
            id,
            name,
            phone,
            sessionId,
            nameExplicit,
        });
    }

    return normalized;
}

function loadRegistryFromEnv() {
    return parseSessionsJson(process.env.JUNE_SESSIONS);
}

/**
 * JUNE_SESSIONS is the sole session configuration mechanism. When no registry
 * exists at all, a single default session (no credentials) is returned so the
 * first-run flow behaves exactly like the old single-session mode: the
 * interactive login menu on a TTY, or a clear exit message headless.
 */
function loadSessionRegistry() {
    // JUNE_SESSIONS is the sole session registry.
    const rawEntries = loadRegistryFromEnv();
    if (rawEntries && rawEntries.length > 0) {
        const clean = normalizeSessionEntries(rawEntries);
        if (clean.length > 0) return clean;
    }
    return [{
        id: DEFAULT_BOT_ID,
        name: 'June X (main)',
        phone: '',
        sessionId: '',
        interactive: true,
    }];
}

/**
 * Parse JUNE_PAIRING_MAX_ATTEMPTS. Default 5 pairing codes per login/recovery
 * cycle; anything below 1 falls back to the default.
 */
function parsePairingMaxAttempts(raw) {
    const n = Math.floor(Number(raw));
    return Number.isFinite(n) && n >= 1 ? n : 5;
}

module.exports = {
    SessionManager,
    BotInstance,
    loadSessionRegistry,
    loadRegistryFromEnv,
    parseSessionsJson,
    normalizeSessionEntries,
    validateSessionEntry,
    addSessionEntry,
    isValidSessionIdFormat,
    VALID_PREFIXES,
    parsePairingMaxAttempts,
    sessionLogLabel,
    sessionLogPrefix,
    DEFAULT_BOT_ID,
};
