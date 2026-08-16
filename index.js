/**
 * June X Ultra — Multi-Session WhatsApp Bot
 * Built on Baileys | Inspired by JUNE-X structure
 *
 * MULTI-SESSION CORE
 * ------------------
 * This build runs any number of WhatsApp sessions inside ONE process:
 *   - each session is a BotInstance (utils/sessionManager) with its own
 *     socket, reconnect state machine, intervals, message store and status
 *     queues;
 *   - each session has its own SQLite database file (june-<botId>.db), so
 *     Signal auth keys, KV data (notes, settings, warnings…) and remote
 *     mirrors are fully isolated per bot;
 *   - commands/config/database reads are routed per bot through
 *     utils/botContext AsyncLocalStorage — command modules are untouched.
 *
 * Sessions are defined via the JUNE_SESSIONS env / .env variable — the sole
 * session registry (JSON array or { "sessions": [...] }). Its .env line
 * hot-reloads: edits are reconciled live (hot-add / hot-remove) without a
 * restart. With no registry, a single default session runs the first-run
 * login flow.
 *
 * Entry shape: { "id": "main", "name": "June Main", "phone": "2547…",
 *                "sessionId": "JUNE-MD:~<base64>" }
 */
// ─── Suppress pg SSL compatibility warning ──────────────────────────
process.on('warning', (warning) => {
    const message = String(warning?.message || '');

    if (
        warning?.code === 'SECURITY WARNING' ||
        message.includes('The SSL modes') &&
        message.includes('pg-connection-string')
    ) {
        return;
    }

    // Keep all other warnings visible
    console.warn(warning);
});
// --- Environment Setup ---
require('dotenv').config();

/*************************************
 * Raw Output Suppression
 *
 * Baileys/libsignal may print recoverable old-session decrypt noise directly
 * to stdout/stderr, bypassing the configured Pino logger. Filter only the
 * known Bad MAC / SessionEntry chatter at stream level; ordinary errors remain.
 *************************************/
const originalWrite = process.stdout.write;
const originalWriteError = process.stderr.write;
const originalLog = console.log;
let suppressSignalStackUntil = 0;

const SIGNAL_NOISE_PATTERNS = [
    'closing session: sessionentry',
    'sessionentry {',
    'failed to decrypt message with any known session',
    'session error: error: bad mac',
    'bad mac error: bad mac',
    'decrypted message with closed session',
    'incoming prekey bundle',
];

function outputText(chunk) {
    if (typeof chunk === 'string') return chunk;
    if (Buffer.isBuffer(chunk)) return chunk.toString('utf8');
    try { return String(chunk); } catch (_) { return ''; }
}

function shouldSuppressSignalNoise(chunk) {
    const message = outputText(chunk);
    const lower = message.toLowerCase();
    const isKnownNoise = SIGNAL_NOISE_PATTERNS.some((pattern) => lower.includes(pattern));

    if (isKnownNoise) {
        // libsignal often prints the error header and stack trace as separate
        // writes. Suppress only its immediately following frames as well.
        suppressSignalStackUntil = Date.now() + 2500;
        return true;
    }

    const isLibsignalFrame =
        lower.includes('/libsignal/') ||
        lower.includes('session_cipher.js') ||
        lower.includes('queue_job.js') ||
        /^\s*at\s/.test(message) ||
        lower.trim() === '...';

    return Date.now() < suppressSignalStackUntil && isLibsignalFrame;
}

function acknowledgeSuppressedWrite(encoding, callback) {
    const done = typeof encoding === 'function' ? encoding : callback;
    if (typeof done === 'function') {
        try { done(); } catch (_) {}
    }
    return true;
}

process.stdout.write = function (chunk, encoding, callback) {
    if (shouldSuppressSignalNoise(chunk)) {
        return acknowledgeSuppressedWrite(encoding, callback);
    }
    return originalWrite.apply(this, arguments);
};

process.stderr.write = function (chunk, encoding, callback) {
    if (shouldSuppressSignalNoise(chunk)) {
        return acknowledgeSuppressedWrite(encoding, callback);
    }
    return originalWriteError.apply(this, arguments);
};

console.log = function (message, ...optionalParams) {
    if (shouldSuppressSignalNoise(message)) return;
    originalLog.apply(console, [message, ...optionalParams]);
};

const fs = require('fs')
const chalk = require('chalk')
const path = require('path')
const os = require('os')
const crypto = require('crypto')

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    jidNormalizedUser,
    makeCacheableSignalKeyStore,
    delay
} = require('@whiskeysockets/baileys')

const NodeCache = require('node-cache')
const pino = require('pino')
const readline = require('readline')
const { rmSync } = require('fs')
const moment = require('moment-timezone')
const lolcatjs = require('lolcatjs')
const { normalizeJidWithLid } = require('./utils/jidHelper')
const { applyFont } = require('./utils/fontConverter')
const { runInBot, DEFAULT_BOT_ID, getCurrentBotId } = require('./utils/core/botContext')
const {
    claimSuperOwner,
    superOwnerStatusFor,
    isPlatformOwner,
    isPlatformOwnerForSession,
} = require('./utils/core/ownership')
const addbotFlow = require('./utils/core/addbotFlow')
const {
    SessionManager,
    requestPairingCodeForCycle,
    loadSessionRegistry,
    parseSessionsJson,
    addSessionEntry,
    normalizeSessionEntries,
    sessionLogLabel,
    sessionLogPrefix,
    parsePairingMaxAttempts,
    VALID_PREFIXES,
} = require('./utils/core/sessionManager')
const {
    atomicWriteFile,
    createDiskManager,
} = require('./utils/juneDb/runtimeProtection')
const juneDatabase = require('./database')
const pgAdapter = require('./utils/juneDb/pgAdapter')
const mongoAdapter = require('./utils/juneDb/mongoAdapter')
const replayDrain = require('./utils/juneDb/replayDrain')
const {
    useSQLiteAuthState,
    getSQLiteAuthStats,
    validateSQLiteAuth,
    migrateFilesToSQLite,
    finalizePendingFileMigration,
    cleanupSessionQuarantines,
    getSessionIdFingerprint,
    setSessionIdFingerprint,
    getSessionIdRevokedFingerprint,
    setSessionIdRevokedFingerprint,
    hasVerifiedSQLiteAuth,
    clearSQLiteAuth,
    invalidateSQLiteAuth,
} = require('./utils/juneDb/auth-state')

process.env.PUPPETEER_SKIP_DOWNLOAD = 'true'
process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD = 'true'

// ─── Centralized Logger ───────────────────────────────────────────────────────

// Late-bound reference so log() can be called during module init, before the
// session manager exists. Assigned right after the manager is constructed.
let sessionManagerRef = null

// ─── Per-session log prefix ─────────────────────────────────────────────────
// Single-session / legacy mode keeps the classic '[ JUNEX ULTRA ]'.
// In multi-session mode every log line is tagged with the session that threw
// it: '[ JUNEX ULTRA 909 ]' (last 3 digits of that session's number) or
// '[ JUNEX ULTRA main ]' before the number is known. Falls back silently to
// the classic prefix whenever the context cannot be resolved.
function logPrefixLabel() {
    try {
        const bot = sessionManagerRef?.get(getCurrentBotId())
        const multiSession = Boolean(sessionManagerRef) && sessionManagerRef.list().length > 1
        return sessionLogPrefix(bot, multiSession)
    } catch (_) {
        return '[ JUNEX ULTRA ]'
    }
}

function log(message, color = 'white', isError = false) {
    const prefix = chalk.blue.bold(logPrefixLabel())
    const logFunc = isError ? console.error : console.log
    const coloredMessage = chalk[color] ? chalk[color](message) : message
    if (message.includes('\n') || message.includes('════')) {
        logFunc(prefix, coloredMessage)
    } else {
        logFunc(`${prefix} ${coloredMessage}`)
    }
}
global.log = log;

// ─── One-box Startup Report ──────────────────────────────────────────────────

const STARTUP_REPORT_WIDTH = 62

function startupPlain(value) {
    return String(value ?? '')
        .replace(/\r?\n/g, ' ')
        .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
}

function startupFit(value, width) {
    const text = startupPlain(value)
    return text.length > width
        ? `${text.slice(0, Math.max(0, width - 1))}…`
        : text.padEnd(width)
}

function startupStatusIcon(status) {
    const normalized = String(status || '').toLowerCase()
    if (['ok', 'ready', 'connected', 'active', 'online', 'enabled', 'passed'].includes(normalized)) {
        return chalk.green('✓')
    }
    if (['warn', 'warning', 'degraded', 'fallback', 'connecting'].includes(normalized)) {
        return chalk.yellow('!')
    }
    if (['off', 'disabled', 'not_set', 'unavailable', 'error', 'failed'].includes(normalized)) {
        return chalk.red('×')
    }
    return chalk.cyan('•')
}

function startupStatusText(status, label) {
    const normalized = String(status || '').toLowerCase()
    const text = label || status || 'unknown'
    if (['ok', 'ready', 'connected', 'active', 'online', 'enabled', 'passed'].includes(normalized)) {
        return chalk.green(text)
    }
    if (['warn', 'warning', 'degraded', 'fallback', 'connecting'].includes(normalized)) {
        return chalk.yellow(text)
    }
    if (['off', 'disabled', 'not_set', 'unavailable', 'error', 'failed'].includes(normalized)) {
        return chalk.red(text)
    }
    return chalk.cyan(text)
}

function startupRow(label, value, status) {
    const left = startupFit(label, 18)
    const right = status
        ? `${startupStatusIcon(status)} ${startupStatusText(status, value)}`
        : startupPlain(value)
    return `│  ${chalk.gray(left)} : ${right}`
}

function startupHeading(title) {
    return `│  ${chalk.cyan.bold(`◆ ${title}`)}`
}

function startupSeparator() {
    return `│  ${chalk.gray('─'.repeat(STARTUP_REPORT_WIDTH - 4))}`
}

function startupToggleValue(enabled) {
    return enabled ? chalk.green('•ON') : chalk.red('•OFF')
}

function startupTogglePair(leftLabel, leftEnabled, rightLabel, rightEnabled) {
    const left = `${chalk.gray(startupFit(leftLabel, 12))} ${startupToggleValue(leftEnabled)}`
    const right = `${chalk.gray(startupFit(rightLabel, 12))} ${startupToggleValue(rightEnabled)}`
    return `│  ${left} ${chalk.gray('│')} ${right}`
}

function normalizeStartupPostgres(postgres = {}) {
    if (postgres.available || postgres.ready) {
        return { ...postgres, status: 'connected', label: 'connected' }
    }
    return { ...postgres, status: 'disabled', label: 'not set' }
}

function getStartupToggleState(db) {
    const statusSettings = db.loadSettings?.() || {}
    const _presence = (() => { try { return require('./utils/presenceSettings').getModes(); } catch (_) { return { pm: 'off', group: 'off' }; } })();
    const _anyTyping = _presence.pm === 'typing' || _presence.group === 'typing';
    const _anyRecording = _presence.pm === 'recording' || _presence.group === 'recording' || _presence.pm === 'recordtype' || _presence.group === 'recordtype';
    const _anyRecordType = _presence.pm === 'recordtype' || _presence.group === 'recordtype';
    const autoReact = (() => {
        try {
            return Boolean(require('./utils/autoReact').load().enabled)
        } catch (_) {
            return Boolean(db.getBotSetting?.('autoReact'))
        }
    })()
    // Auto-download status has one source of truth: SQLite bot_settings.
    const autoDownload = Boolean(db.getAutoDownloadStatusSettings().enabled)
    // Anti-feature configuration is read directly from SQLite. There is no
    // data/*.json or config.js fallback for these values.
    const antideleteMode = db.getAntideleteMode()
    const antideleteStatus = db.isAntideleteStatusEnabled()

    return {
        autoStatusView: Boolean(statusSettings.enabled),
        autoStatusReact: Boolean(statusSettings.react),
        autoTyping: _anyTyping,
        autoRecording: _anyRecording,
        autoRecordType: _anyRecordType,
        autoDownload,
        alwaysOnline: Boolean(db.getBotSetting?.('alwaysOnline')),
        antideleteStatus,
        autoReact,
        antiDelete: antideleteMode !== 'off',
    }
}


function printStartupReport(data = {}) {
    const now = data.time || new Date().toLocaleTimeString();
    const platform = data.platform || os.platform();
    const mode = String(data.mode || 'public').toUpperCase();
    const commandCount = data.commandCount ?? '—';
    const botLabel = data.botLabel || 'JUNE X';

    // Get database info
    const dbInfo = data.databaseInfo || getExternalDatabaseStatus();

    // Build database rows
    let databaseRows = [
        startupHeading('DATABASE'),
        startupRow('SQLite', data.sqliteLabel || 'ready', data.sqliteStatus || 'ready'),
        startupRow('Driver', data.sqliteDriver || 'sql.js-fallback'),
        startupRow('Schema', data.schemaVersion ? `v${data.schemaVersion}` : '—'),
        startupRow('Integrity', data.integrityLabel || 'passed', data.integrityStatus || 'passed'),
    ];

    // Show both available remote adapters while none is configured. Once a
    // remote database is configured, show only the configured adapter(s).
    const configuredExternal = (dbInfo.databases || []).filter((entry) => entry.configured)
    databaseRows.push(startupSeparator());
    databaseRows.push(startupHeading(
        configuredExternal.length > 0 ? 'EXTERNAL DATABASE' : 'EXTERNAL DATABASES'
    ));

    if (configuredExternal.length === 0) {
        for (const entry of dbInfo.databases || []) {
            databaseRows.push(startupRow(entry.name, 'not configured', 'not_set'));
        }
    } else {
        for (const entry of configuredExternal) {
            databaseRows.push(startupRow(
                entry.name,
                entry.connected ? 'connected' : 'unavailable — SQLite fallback',
                entry.connected ? 'connected' : 'warning'
            ));
        }
    }

    const lines = [
        `┌${'─'.repeat(48- 2)}┐`,
        `┃${chalk.cyan('┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓').padEnd(10 - 1)}┃`,
        `┃${chalk.white.bold(`        🤖 ${startupFit(botLabel, 32)} STARTING...`).padEnd(66 - 1)}┃`,
        `┃${chalk.cyan('┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛').padEnd(10 - 1)}┃`,
        `├${'─'.repeat(48 - 2)}┤`,
        startupHeading('SYSTEM'),
        startupRow('Platform', platform),
        startupRow('Node.js', data.nodeVersion || process.version),
        startupRow('Time', now),
        startupRow('Startup', data.startupTime || '—'),
        startupSeparator(),
        startupHeading('CONFIGURATION'),
        startupRow('Prefix', data.prefix ?? '.'),
        startupRow('Mode', mode, 'active'),
        startupRow('Owner', data.owner || 'configured'),
        startupRow('Commands', `${commandCount} loaded`, 'ready'),
        startupSeparator(),
        ...databaseRows,
        startupSeparator(),
        startupHeading('TOGGLES'),
        startupTogglePair('Status View', data.toggles?.autoStatusView, 'Status React', data.toggles?.autoStatusReact),
        startupTogglePair('Typing', data.toggles?.autoTyping, 'Recording', data.toggles?.autoRecording),
        startupTogglePair('Record+Type', data.toggles?.autoRecordType, 'Auto-Save', data.toggles?.autoDownload),
        startupTogglePair('Auto-React', data.toggles?.autoReact, 'Always-On', data.toggles?.alwaysOnline),
        startupTogglePair('Anti-Delete', data.toggles?.antiDelete, 'Anti-Status', data.toggles?.antideleteStatus),
        startupSeparator(),
        startupHeading('RUNTIME PROTECTION'),
        startupRow('Disk manager', data.diskManagerLabel || 'active', data.diskManagerStatus || 'active'),
        startupRow('Atomic writes', data.atomicWritesLabel || 'enabled', data.atomicWritesStatus || 'enabled'),
        startupRow('Cache limits', data.cacheLabel || 'enabled', data.cacheStatus || 'enabled'),
        startupRow('Telemetry', data.telemetryLabel || 'enabled', data.telemetryStatus || 'enabled'),
        startupRow('Shutdown', data.shutdownLabel || 'protected', data.shutdownStatus || 'active'),
        startupSeparator(),
        startupHeading('AUTHENTICATION'),
        startupRow('Session', data.sessionLabel || 'restored', data.sessionStatus || 'ready'),
        startupRow('Auth source', data.authSource || 'SQLite'),
        startupRow('Signal keys', data.signalKeysLabel || 'verified', data.signalKeysStatus || 'ready'),
        startupSeparator(),
        startupHeading('CONNECTION'),
        startupRow('WhatsApp', data.whatsappLabel || 'connecting', data.whatsappStatus || 'connecting'),
        startupRow('Account', data.accountLabel || 'hidden', data.accountStatus),
        startupRow('Group join', data.groupJoinLabel || 'not set', data.groupJoinStatus),
        `│  ${chalk.gray('─'.repeat(49 - 4))}`,
        `│  ${chalk.gray.bold('(•ˇ_ˇ•)  JUNE SYSTEM REPORT SUMMARY   (•ˇ_ˇ•)')}`,
  `│  ${chalk.gray('─'.repeat(49- 4))}`,
        `┗${'━'.repeat(46)}┛`,
    ];

    //console.clear();
    console.log(lines.join('\n'));

    // Log actual remote adapter state without exposing connection strings.
    const configuredExternalForLog = (dbInfo.databases || []).filter((entry) => entry.configured)
    const connectedExternal = configuredExternalForLog.filter((entry) => entry.connected)
    if (connectedExternal.length > 0) {
        log(`[ DATABASE ] External database connected: ${connectedExternal.map((entry) => entry.name).join(', ')}`, 'green');
    }
    if (configuredExternalForLog.some((entry) => !entry.connected)) {
        log('[ DATABASE ] A configured external database is unavailable; using SQLite safely.', 'yellow');
    }
    if (configuredExternalForLog.length === 0) {
        log('[ DATABASE ] No external database configured (using SQLite only)', 'cyan');
    }
}

// ─── Paths ────────────────────────────────────────────────────────────────────

global.__CORE__ = __dirname
global.__ROOT__ = __dirname

const config = require('./config')

const envPath = path.join(process.cwd(), '.env')
// Login metadata and session-ID fingerprints are stored in SQLite metadata.
// Raw sessionId values remain environment-only secrets.

// ─── Auto-generate .env if missing ────────────────────────────────────────────
if (!fs.existsSync(envPath)) {
    const defaultEnv = [
        '# ════════════════════════════════════════════════════════════',
        '# June X — Environment Variables',
        '# ════════════════════════════════════════════════════════════',
        '',
        '# ── SESSIONS (JUNE_SESSIONS is the only session config) ────',
        '#',
        '# One session:',
        '#    JUNE_SESSIONS=[{"sessionId":"JUNE-MD:~...","phone":"2348..."}]',
        '#',
        '# Multiple sessions (one process, isolated per bot):',
        '#    JUNE_SESSIONS=[{"sessionId":"JUNE-MD:~...","phone":"2348..."},{"sessionId":"","phone":"2348..."}]',
        '#',
        '# MUST be one line of JSON (multi-line values do not parse in .env).',
        '#',
        '#    sessionId  JUNE-MD:~ / Ultra-X:~ / June-Ultra:~ / June::~ + base64',
        '#    phone      digits with country code -> pairing-code login +',
        '#               auto-fallback whenever the sessionId fails (the bot\'s key)',
        '#    id / name  optional overrides — otherwise id is derived from the',
        '#               phone (duplicates get -2, -3) and name is "June X <last3>"',
        '#',
        '# HOT-RELOAD: editing this line while the bot runs adds/removes',
        '# sessions live (within seconds) — no restart needed.',
        '#',
        '# No registry at all -> single default session with the first-run',
        '# login flow (interactive menu, or exit message when headless).',
        'JUNE_SESSIONS=',
        '',
        '# ── EXTERNAL DATABASES (optional; per-bot rows are separated',
        '#    by bot_id automatically) ───────────────────────────────',
        '# PostgreSQL:  postgres://user:pass@host:5432/dbname',
        'DATABASE_URL=',
        '# MongoDB:     mongodb+srv://user:pass@cluster/dbname',
        'MONGODB_URI=',
        '',
        '# ── SESSION / PAIRING TUNING (optional) ─────────────────────',
        '# Pairing codes issued per login/recovery cycle (default 3);',
        '# after the limit the session parks as needs-login until .restart',
        'JUNE_PAIRING_MAX_ATTEMPTS=3',
        '# Hot-add/hot-remove registry poll interval ms (default 15000)',
        'JUNE_SESSIONS_POLL_MS=15000',
        '# Auto-export refreshed session creds back to .env JUNE_SESSIONS',
        'JUNE_EXPORT_SESSION_TO_ENV=false',
        '',
        '# ── OTHER ───────────────────────────────────────────────────',
        '# Dashboard port (default 5000)',
        '# PORT=5000',
    ].join('\n')
    atomicWriteFile(envPath, defaultEnv, 'utf8')
    log('[ .env ] No .env file found — created with default template.', 'green')
}

// ─── Session manager ──────────────────────────────────────────────────────────

const sessionManager = new SessionManager()
sessionManagerRef = sessionManager

// How many pairing codes may be issued per login/recovery cycle before the
// session parks itself as needs-login. Per-session counters are isolated;
// this value only sets the shared limit. Configurable: JUNE_PAIRING_MAX_ATTEMPTS.
const PAIRING_MAX_ATTEMPTS = parsePairingMaxAttempts(process.env.JUNE_PAIRING_MAX_ATTEMPTS)
// Socket-stabilize wait before requesting a pairing code (legacy flows only;
// live .addbot/.repairbot flows are capped by addbotFlow.flowStabilizeMs).
const PAIRING_STABILIZE_MS = addbotFlow.parseStabilizeMs(process.env.JUNE_PAIRING_STABILIZE_MS)

// ─── JUNE_SESSIONS hot-reload (sole registry, .env file) ─────────────────────
// The .env file's JUNE_SESSIONS line is the single source of truth. Whenever
// it changes (detected by the file watcher or the periodic poll), the value is
// re-read, parsed and reconciled against the running sessions: new ids are
// hot-added, removed ids are hot-removed — running sessions are never touched.
//
// Rules:
//   - The line must be ONE line of JSON (multi-line values cannot live in .env).
//   - A missing line means the value is platform-managed (panel env var) — the
//     file is never consulted and edits to it change nothing.
//   - An invalid JSON line is logged and ignored until fixed (typos must never
//     tear down running sessions).
//   - An empty value removes every registry-managed session (hot-remove).

let _lastEnvJuneSessions = null // last applied raw line value

function readJuneSessionsLineFromEnv() {
    try {
        if (!fs.existsSync(envPath)) return { present: false, value: '' }
        const lines = fs.readFileSync(envPath, 'utf8').split('\n')
        for (const line of lines) {
            const trimmed = line.trim()
            if (trimmed.startsWith('#') || !trimmed.startsWith('JUNE_SESSIONS=')) continue
            // Everything after the first '=' is the value (preserves '=' inside base64)
            return { present: true, value: trimmed.slice('JUNE_SESSIONS='.length).trim() }
        }
        return { present: false, value: '' }
    } catch (e) {
        log(`[ .env ] Failed to read JUNE_SESSIONS: ${e.message}`, 'red', true)
        return { present: false, value: '' }
    }
}

/**
 * Re-read the JUNE_SESSIONS line from the .env file. Returns true when the
 * value changed and was applied to process.env (trigger a live reconcile).
 */
function syncJuneSessionsFromEnvFile() {
    const { present, value } = readJuneSessionsLineFromEnv()
    if (!present) return false // platform-managed value — nothing file-based to sync
    if (value === _lastEnvJuneSessions) return false

    // Never apply garbage: an invalid JSON line must not tear sessions down.
    if (value.trim() !== '' && !parseSessionsJson(value)) {
        log('[ MULTI-SESSION ] JUNE_SESSIONS in .env is not valid JSON — ignoring until fixed.', 'red', true)
        return false
    }

    _lastEnvJuneSessions = value
    if (value.trim() === '') delete process.env.JUNE_SESSIONS
    else process.env.JUNE_SESSIONS = value
    return true
}

global.__JUNE_SYNC_SESSIONS = syncJuneSessionsFromEnvFile

/**
 * Rewrite the .env file's JUNE_SESSIONS line in place (single source of
 * truth). Returns false when the file has no JUNE_SESSIONS line — the value
 * is then platform-managed and cannot be edited at runtime.
 */
function writeJuneSessionsLineToEnv(newValue) {
    try {
        if (!fs.existsSync(envPath)) return false
        const envContent = fs.readFileSync(envPath, 'utf8')
        if (!/^JUNE_SESSIONS=.*$/m.test(envContent)) return false
        global._suppressEnvWatcherUntil = Date.now() + 3000
        atomicWriteFile(
            envPath,
            envContent.replace(/^JUNE_SESSIONS=.*$/m, `JUNE_SESSIONS=${newValue}`)
        )
        _lastEnvJuneSessions = newValue // our own write — no watcher reaction needed
        return true
    } catch (_) {
        return false
    }
}

/**
 * .addbot runtime hook: validate + append a session to the JUNE_SESSIONS
 * registry (process.env and, when possible, the .env line), then reuse the
 * existing reconciliation pipeline for the hot-add. No second hot-add
 * implementation — existing sessions are never touched.
 */
// ─── Live addbot flow (in-chat code delivery, reactions) ────────────────────
// Delivery state only — this map is NOT authoritative pairing state.
// Pairing activity/generation lives on BotInstance. A terminal notification may
// remain queued here after pairing has already ended without reactivating it.
// newBotId -> { chatJid, viaBotId, quotedMsg, phone, lastCode, lastAttempt,
//               statusText }: where to deliver codes/status notifications.
const _pendingAddRequests = new Map()

const FLOW_SEND_ATTEMPTS = 3
const FLOW_SEND_RETRY_DELAY_MS = 1500

// Delivery order (all paths now use the FIXED full-message quote):
//   1) gifted-btns with the panel-proven quick-reply style ({ id, text } —
//      the same shape botinfo.js sends and which renders on real panels)
//   2) plain text (guaranteed to render)
// Button delivery failures always fall through to text — the code can
// never be lost again.
async function sendFlowMessage(viaBotId, chatJid, content, quotedMsg) {
    const candidates = [
        sessionManager.get(viaBotId),
        ...sessionManager.list().filter((b) => String(b.id) !== String(viaBotId)),
    ].filter(Boolean)

    const text = content?.text || String(content || '')
    // Baileys' quote path reads quoted.message — only quote when the full
    // message payload is present (pure helper, regression-tested).
    const quoteOpt = addbotFlow.buildFlowQuoteOptions(quotedMsg)

    for (let attempt = 0; attempt < FLOW_SEND_ATTEMPTS; attempt++) {
        for (const bot of candidates) {
            if (!bot.sock || bot.botState !== 'connected') continue

            // 1) Buttons — the panel-proven quick-reply path.
            if (content?.withButtons) {
                try {
                    const { sendButtons } = require('gifted-btns')
                    await sendButtons(bot.sock, chatJid, addbotFlow.buildSimpleButtons(content), quoteOpt)
                    return true
                } catch (e) {
                }
            }

            // 2) Plain text — always renders.
            try {
                await bot.sock.sendMessage(chatJid, { text }, quoteOpt)
                return true
            } catch (e) {
            }
            try {
                await bot.sock.sendMessage(chatJid, { text })
                return true
            } catch (e) {
            }
        }
        if (attempt < FLOW_SEND_ATTEMPTS - 1) {
            await new Promise((r) => setTimeout(r, FLOW_SEND_RETRY_DELAY_MS))
        }
    }
    return false
}

async function reactFlowMessage(viaBotId, chatJid, emoji, key) {
    if (!key) return false
    const candidates = [
        sessionManager.get(viaBotId),
        ...sessionManager.list().filter((b) => String(b.id) !== String(viaBotId)),
    ].filter(Boolean)
    for (const bot of candidates) {
        if (!bot.sock || bot.botState !== 'connected') continue
        try {
            await bot.sock.sendMessage(chatJid, { react: { text: emoji, key } })
            return true
        } catch (_) { /* try the next session */ }
    }
    return false
}

async function deliverPairingCodeToRequester(bot, socket, reservation, code) {
    // Delivery routing may outlive pairing for terminal-message retries, so the
    // active cycle/socket token — not map presence — authorizes code delivery.
    if (!bot.isPairingRequestCurrent(reservation, socket)) return false
    const pending = _pendingAddRequests.get(bot.id)
    if (!pending || pending.statusText) return false

    pending.lastCode = code
    pending.lastAttempt = reservation.attempt
    pending.codeGeneration = reservation.generation
    const payload = addbotFlow.buildCodeMessage({
        code,
        attempt: reservation.attempt,
        max: PAIRING_MAX_ATTEMPTS,
        phone: bot.phone || pending.phone,
        botId: bot.id,
    })

    // Revalidate immediately before entering the asynchronous send path.
    if (!bot.isPairingRequestCurrent(reservation, socket)) return false
    return sendFlowMessage(pending.viaBotId, pending.chatJid, payload, pending.quotedMsg)
}

async function deliverAddbotFlowStatus(bot, state, detail) {
    const pending = _pendingAddRequests.get(bot.id)
    if (!pending) return
    let text = addbotFlow.buildStatusMessage(state, pending.phone)
    if (detail) text += `\n\n_${String(detail).slice(0, 120)}_`
    pending.statusText = text
    const ok = await sendFlowMessage(pending.viaBotId, pending.chatJid, { text }, pending.quotedMsg)
    await reactFlowMessage(pending.viaBotId, pending.chatJid,
        state === 'connected' ? '✅' : '⚠️', pending.quotedMsg?.key || null)
    if (ok) {
        _pendingAddRequests.delete(bot.id)
        dropPendingChat(bot.id)
    } else {
    }
}

// When the delivering session reconnects, re-attempt any outstanding flow
// messages (the latest code, or a pending terminal status).
async function retryPendingFlowDeliveries(viaBotId) {
    for (const [newBotId, pending] of [..._pendingAddRequests.entries()]) {
        if (String(pending.viaBotId) !== String(viaBotId)) continue
        if (pending.statusText) {
            const ok = await sendFlowMessage(viaBotId, pending.chatJid, { text: pending.statusText }, pending.quotedMsg)
            if (ok) {
                _pendingAddRequests.delete(newBotId)
                dropPendingChat(newBotId)
            }
        } else if (pending.lastCode) {
            const targetBot = sessionManager.get(newBotId)
            // Never replay a code after success, removal, repair, restart, or
            // any other generation change. Notification retries are separate
            // from pairing authority.
            if (!targetBot?.hasActivePairingCycle(pending.codeGeneration)) continue
            const payload = addbotFlow.buildCodeMessage({
                code: pending.lastCode,
                attempt: pending.lastAttempt || 1,
                max: PAIRING_MAX_ATTEMPTS,
                phone: pending.phone,
                botId: newBotId,
            })
            await sendFlowMessage(viaBotId, pending.chatJid, payload, pending.quotedMsg)
        }
    }
}

async function addSessionViaRegistry(entry = {}, meta = {}) {
    const registry = parseSessionsJson(process.env.JUNE_SESSIONS) || []
    const base = addSessionEntry(registry, entry)
    if (!base.ok) return base

    // The runtime registry may be ahead of (or behind) the env registry —
    // check the running sessions for storage/credential conflicts too.
    const phone = base.entry.phone
    const sessionId = base.entry.sessionId
    const runningConflict = sessionManager.list().some((bot) =>
        bot.phone === phone || (sessionId && bot.sessionId === sessionId)
    )
    if (runningConflict) return { ok: false, reason: 'duplicate' }

    // Quotas: global session cap (JUNE_MAX_SESSIONS) and WhatsApp's per-number
    // device cap. Initial-registry sessions are never quota-checked — this is
    // a runtime .addbot guard only.
    const quota = addbotFlow.checkAddQuota({
        registry,
        runningPhones: sessionManager.list().map((bot) => bot.phone),
        phone,
        max: process.env.JUNE_MAX_SESSIONS,
    })
    if (!quota.ok) return quota

    const value = JSON.stringify(base.registry)
    process.env.JUNE_SESSIONS = value
    const persisted = writeJuneSessionsLineToEnv(value)

    // Register the live flow FIRST (so the pairing code can be delivered the
    // moment it is generated), then reconcile immediately — no debounce
    // wait, the hot-add starts right away. reconcileSessions is guarded by
    // _reconcileRunning, so the watcher/poll can never double-run it.
    const derivedId = (normalizeSessionEntries([base.entry])[0] || {}).id || phone
    if (meta && meta.chatJid && meta.viaBotId) {
        _pendingAddRequests.set(derivedId, {
            chatJid: meta.chatJid,
            viaBotId: meta.viaBotId,
            quotedMsg: meta.quotedMsg || null,
            phone,
        })
        rememberPendingChat(derivedId, meta.chatJid)
    }

    void reconcileSessions().catch((err) => {
        log(`[ MULTI-SESSION ] Immediate reconcile failed: ${err?.message || err}`, 'red', true)
        scheduleSessionReconcile()
    })

    return { ok: true, id: derivedId, phone, sessionId, persisted }
}

/**
 * .delbot runtime hook: remove an entry (by phone or id) from the
 * JUNE_SESSIONS registry and reuse the existing reconciliation pipeline for
 * the hot-remove. No second hot-remove implementation.
 */
async function removeSessionViaRegistry(identifier = '') {
    const registry = parseSessionsJson(process.env.JUNE_SESSIONS) || []
    const res = addbotFlow.removeRegistryEntry(registry, identifier)
    if (!res.ok) return res

    // Invalidate synchronously, before registry reconciliation or notification
    // delivery, so queued/stale handlers cannot request or send another code.
    const removedId = String(res.removed?.id || '')
    const removedPhone = addbotFlow.digitsOnly(res.removed?.phone)
    const runningBot = sessionManager.list().find((bot) =>
        (removedId && String(bot.id) === removedId) ||
        (removedPhone && addbotFlow.digitsOnly(bot.phone) === removedPhone)
    )
    runningBot?.terminatePairingCycle('delbot')

    const value = JSON.stringify(res.registry)
    process.env.JUNE_SESSIONS = value
    const persisted = writeJuneSessionsLineToEnv(value)

    // If this removal kills an in-flight addbot flow, close the flow first.
    for (const [botId, pending] of _pendingAddRequests) {
        if (removedPhone && addbotFlow.digitsOnly(pending.phone) === removedPhone) {
            await deliverAddbotFlowStatus({ id: botId }, 'cancelled')
        }
    }

    scheduleSessionReconcile()
    return { ok: true, removed: res.removed, persisted }
}

/**
 * .repairbot runtime hook: re-arm a parked session through the existing
 * per-session restart (fresh pairing cycle with the configured phone).
 */
async function repairSessionByIdentifier(identifier = '', meta = {}) {
    const raw = String(identifier || '').trim()
    const digits = addbotFlow.digitsOnly(identifier)
    const bot = sessionManager.list().find((b) =>
        b.id === raw || (digits && addbotFlow.digitsOnly(b.phone) === digits)
    )
    if (!bot) return { ok: false, reason: 'unknown' }
    if (bot.botState === 'connected') return { ok: false, reason: 'online', id: bot.id }
    // A repaired session's fresh pairing code + status flow back into the
    // chat that requested the repair (same live-flow bridge as .addbot).
    if (meta && meta.chatJid && meta.viaBotId) {
        // A repair is a new operation: replace any stale terminal-notification
        // delivery record without relying on it as pairing state.
        _pendingAddRequests.set(bot.id, {
            chatJid: meta.chatJid,
            viaBotId: meta.viaBotId,
            quotedMsg: meta.quotedMsg || null,
            phone: bot.phone,
        })
        rememberPendingChat(bot.id, meta.chatJid)
    }
    const result = await restartBot(bot.id, { pairingReason: 'repairbot' })
    return { ok: Boolean(result?.ok), id: bot.id, error: result?.error }
}

// ── Live-flow buttons (copy code / cancel) ────────────────────────────────────
// Chat-indexed flow lookup: WhatsApp may deliver a button reply with an
// EMPTY selectedId (label only), so the cancel handler can resolve the flow
// purely from the chat the tap arrived in.
const _pendingByChat = new Map() // normalized chatJid -> newBotId

function normalizeFlowChat(jid) {
    try { return normalizeJidWithLid(String(jid || '')) } catch (_) { return String(jid || '') }
}

function rememberPendingChat(newBotId, chatJid) {
    const key = normalizeFlowChat(chatJid)
    if (key) _pendingByChat.set(key, String(newBotId))
}

function dropPendingChat(newBotId) {
    for (const [chatKey, botId] of [..._pendingByChat.entries()]) {
        if (String(botId) === String(newBotId)) _pendingByChat.delete(chatKey)
    }
}

async function handleAddbotButton(buttonId, chatJid, sender, msg) {
    try {
        const rawId = String(buttonId || '')
        const displayText = String(
            msg?.message?.templateButtonReplyMessage?.selectedDisplayText || rawId || ''
        )
        const resolved = addbotFlow.resolveFlowTap({
            buttonId: rawId,
            displayText,
            chatBotId: _pendingByChat.get(normalizeFlowChat(chatJid)) || undefined,
        })
        if (!resolved) {
            return
        }
        const { action, botId: newBotId } = resolved
        if (action === 'copy') {
            return
        }

        // cancel path
        const pending = newBotId ? _pendingAddRequests.get(newBotId) : null
        if (!pending) {
            return
        }
        // Chat tolerance: accept the tap from the recorded chat OR any chat
        // (PN/LID variants of the same conversation differ) — the sender is
        // still verified below, so this never widens the security boundary.
        const senderNumber = String(sender || '').split(':')[0].split('@')[0]
        const ownerSession = sessionManager.get(pending.viaBotId)
        if (!isPlatformOwnerForSession(senderNumber, ownerSession?.phone)) {
           if (isPlatformOwner(senderNumber)) return
            await sendFlowMessage(pending.viaBotId, chatJid,
                { text: config.messages.superOwnerOnly || '👑 Super Owner only!' },
                pending.quotedMsg)
            return
        }
        
        const removed = await removeSessionViaRegistry(pending.phone)
        if (!removed.ok && removed.reason === 'unknown') {
            // The session may already be gone from the registry — treat the
            // flow as cancelled anyway.
        }
        if (_pendingAddRequests.has(newBotId)) {
            await deliverAddbotFlowStatus({ id: newBotId }, 'cancelled')
        }
        dropPendingChat(newBotId)
    } catch (e) {
        log(`Button tap handler error: ${e?.message || e}`, 'red', true)
    }
}

global.__JUNE_ADD_SESSION = addSessionViaRegistry
global.__JUNE_REMOVE_SESSION = removeSessionViaRegistry
global.__JUNE_REPAIR_SESSION = repairSessionByIdentifier
global.__JUNE_ADD_BOT_BUTTON = handleAddbotButton
global.__JUNE_SESSIONS_SNAPSHOT = () => sessionManager.snapshot()

// ─── Cleanup Functions ────────────────────────────────────────────────────────

function clearSessionFiles(bot) {
    try {
        //log(`[ CLEARING:${bot.id} ] session folder...`, 'blue')
        if (fs.existsSync(bot.sessionDir)) {
            const quarantinePath = `${bot.sessionDir}.quarantine-${Date.now()}`
            try {
                fs.renameSync(bot.sessionDir, quarantinePath)
                log(`[ SESSION:${bot.id} ] Previous auth preserved at ${path.basename(quarantinePath)}.`, 'yellow')
            } catch (renameError) {
                log(`[ SESSION:${bot.id} ] Could not quarantine old auth: ${renameError.message}`, 'yellow')
                rmSync(bot.sessionDir, { recursive: true, force: true })
            }
        }
        bot.db.clearStoredLoginMethod()
        bot.db.clearSessionErrorState()
        bot.errorRetryCount = 0
        bot.db.clearSession()
        clearSQLiteAuth(bot.db._db, 'session-cleared')
        // A deliberate local logout/session clear must not leave an older
        // remote auth state behind in the external mirror.
        bot.db.clearRemoteAuthState()
        clearSessionIdFingerprint(bot)
        bot.db.markDatabaseDirty('session-cleared')
       // log(`[ SESSION:${bot.id} ] files cleared successfully.`, 'green')
    } catch (e) {
        log(`Failed to clear session files (${bot.id}): ${e.message}`, 'red', true)
    }
}

const ROOT_TEMP_FILE_PATTERN = /^(?:tmp|temp|download|converted|upload|media|sticker)[._-]/i
const ROOT_TEMP_EXTENSIONS = new Set(['.gif', '.png', '.mp3', '.mp4', '.opus', '.jpg', '.jpeg', '.webp', '.webm', '.zip'])
const ROOT_TEMP_MAX_AGE_MS = 60 * 60 * 1000

function cleanupJunkFiles(sock) {
    const dir = path.join(__dirname)
    fs.readdir(dir, { withFileTypes: true }, (err, entries) => {
        if (err) return log(`[Junk Cleanup] Error reading dir: ${err}`, 'red', true)
        const cutoff = Date.now() - ROOT_TEMP_MAX_AGE_MS
        const junk = entries.filter((entry) => {
            if (!entry.isFile()) return false
            const ext = path.extname(entry.name).toLowerCase()
            if (!ROOT_TEMP_EXTENSIONS.has(ext) || !ROOT_TEMP_FILE_PATTERN.test(entry.name)) return false
            try {
                return fs.statSync(path.join(dir, entry.name)).mtimeMs < cutoff
            } catch (_) {
                return false
            }
        }).map((entry) => entry.name)

        if (junk.length === 0) return
        if (sock?.user?.id) {
            sock.sendMessage(sock.user.id.split(':')[0] + '@s.whatsapp.net', {
                text: `🧹 Removed ${junk.length} expired temporary file(s).`
            }).catch(() => {})
        }
        for (const file of junk) {
            try { fs.unlinkSync(path.join(dir, file)) } catch (_) {}
        }
        log(`[Junk Cleanup] Removed ${junk.length} expired temporary root file(s).`, 'yellow')
    })
}

let diskManager = null
function runEmergencyCleanup({ aggressive = false } = {}) {
    // Anti-delete records are SQLite-backed and bounded by database maintenance.
    for (const bot of sessionManager.list()) {
        try { bot.db.pruneAntideleteData?.() } catch (_) {}
    }
    try { cleanupJunkFiles(null) } catch (_) {}
    for (const bot of sessionManager.list()) {
        try { cleanupExpiredSessionQuarantines(bot, 'low-disk cleanup') } catch (_) {}
    }
    try { handler?.cleanupRuntimeCaches?.(aggressive) } catch (_) {}
    for (const bot of sessionManager.list()) {
        try { Promise.resolve(bot.db.flushBackup?.()).catch(() => {}) } catch (_) {}
    }
}

diskManager = createDiskManager({
    root: __dirname,
    cleanup: ({ aggressive }) => {
        runEmergencyCleanup({ aggressive })
        log(`[ DISK ] Low storage detected; ${aggressive ? 'emergency ' : ''}cleanup completed.`, 'yellow')
    },
})
global.diskManager = diskManager

// ─── Readline (interactive login for the default session) ────────────────────

const rl = process.stdin.isTTY
    ? readline.createInterface({ input: process.stdin, output: process.stdout })
    : null
const question = (text) => rl
    ? new Promise(resolve => rl.question(text, resolve))
    : Promise.resolve('')

// ─── Session Helpers (per bot) ────────────────────────────────────────────────

const sessionExists = (bot) => fs.existsSync(bot.credsPath)

function fingerprintSessionId(sessionId) {
    return crypto.createHash('sha256').update(String(sessionId)).digest('hex')
}

function hasUsableFileSession(bot) {
    if (!sessionExists(bot)) return false
    try {
        const creds = JSON.parse(fs.readFileSync(bot.credsPath, 'utf8'))
        return !!(creds && typeof creds === 'object' && (
            creds.noiseKey ||
            creds.signedIdentityKey ||
            creds.registrationId ||
            creds.registered === true
        ))
    } catch (_) {
        return false
    }
}

function rememberSessionIdFingerprint(bot, fingerprint) {
    if (!fingerprint) return false

    setSessionIdFingerprint(bot.db._db, fingerprint)
    const persisted = getSessionIdFingerprint(bot.db._db)
    if (persisted !== fingerprint) {
        // Never print the fingerprint itself. The presence check is enough to
        // diagnose persistence without exposing any session-derived value.
        log(`[ AUTH META:${bot.id} ] sessionId fingerprint could not be verified in SQLite.`, 'red', true)
        return false
    }

    bot.db.markDatabaseDirty('session-id-fingerprint')
   // log(`[ AUTH META:${bot.id} ] sessionId fingerprint saved in SQLite.`, 'green')
    return true
}

function clearSessionIdFingerprint(bot) {
    setSessionIdFingerprint(bot.db._db, null)
    bot.db.markDatabaseDirty('session-id-fingerprint-cleared')
}

function markSessionIdFingerprintRevoked(bot, fingerprint) {
    if (!fingerprint) return
    setSessionIdRevokedFingerprint(bot.db._db, fingerprint)
    bot.db.markDatabaseDirty('session-id-revoked')
}

function clearRevokedSessionIdFingerprint(bot) {
    setSessionIdRevokedFingerprint(bot.db._db, null)
    bot.db.markDatabaseDirty('session-id-revocation-cleared')
}

function cleanupExpiredSessionQuarantines(bot, source = 'startup') {
    const result = cleanupSessionQuarantines(bot.sessionDir)
    if (result.removed.length > 0) {
        const details = []
        if (result.removedByRetention) details.push(`${result.removedByRetention} expired`)
        if (result.removedByLimit) details.push(`${result.removedByLimit} over limit`)
        log(
            `[ SESSION:${bot.id} ] Removed ${result.removed.length} quarantine(s) during ${source}${details.length ? ` (${details.join(', ')})` : ''}.`,
            'yellow'
        )
    }
    return result
}

// A new sessionId deliberately replaces file auth once. The old directory is
// preserved as a short-lived quarantine backup, never deleted during the swap.
function quarantineCurrentSessionForReplacement(bot) {
    if (!fs.existsSync(bot.sessionDir)) return null
    try {
        const entries = fs.readdirSync(bot.sessionDir)
        if (entries.length === 0) {
            fs.rmSync(bot.sessionDir, { recursive: true, force: true })
            return null
        }
        const quarantinedPath = `${bot.sessionDir}.quarantine-${Date.now()}`
        fs.renameSync(bot.sessionDir, quarantinedPath)
        return quarantinedPath
    } catch (error) {
        throw new Error(`Could not preserve the current session directory: ${error.message}`)
    }
}

// ─── Session Format Validator ─────────────────────────────────────────────────
// Session ID formats: JUNE-MD:~<base64> | Ultra-X:~<base64> | June-Ultra:~<base64>

function validateSessionIdFormat(sessionId) {
    const value = String(sessionId || '').trim()
    if (!value) return true // absence is fine — handled by the login flow
    return VALID_PREFIXES.some(p => value.startsWith(p))
}

async function checkAndHandleSessionFormat(bot) {
    const sessionId = String(bot.sessionId || '').trim()
    if (sessionId && !validateSessionIdFormat(sessionId)) {
        log(chalk.black.bgYellowBright(`[ERROR:${bot.id}] Invalid sessionId format.`), 'white')
        log(chalk.black.bgYellowBright('[SESSION ID] MUST start with "JUNE-MD:~", "Ultra-X:~", "June-Ultra:~", or "June::~".'), 'white')
        const isSoloLegacySession = sessionManager.list().length === 1 && bot.id === DEFAULT_BOT_ID
        if (isSoloLegacySession) {
            log(chalk.black.bgYellowBright('Please fix the sessionId in your session registry and restart. Exiting in 20 seconds...'), 'white')
            await delay(20000)
            process.exit(1)
        }
        log(`[ SESSION:${bot.id} ] Skipping this session; fix its sessionId in the JUNE_SESSIONS registry (.env).`, 'red', true)
        bot.botState = 'needs-login'
        bot.lastError = 'Invalid sessionId format'
        return false
    }
    return true
}

// ─── Download Session from sessionId ─────────────────────────────────────────

async function downloadSessionData(bot) {
    await fs.promises.mkdir(bot.sessionDir, { recursive: true })
    if (!fs.existsSync(bot.credsPath) && bot.sessionId) {
        const sid = bot.sessionId
        let sessionData

        const prefixMap = [
            'Ultra-X:~',
            'June-Ultra:~',
            'JUNE-MD:~',
            'June::~',
        ]
        const matched = prefixMap.find(p => sid.startsWith(p))
        if (!matched) throw new Error(`Unknown session Format: ${prefixMap.join(', ')}`)

        const b64 = sid.slice(matched.length)
        sessionData = Buffer.from(b64, 'base64')
        // Validate that the decoded content is valid JSON before writing
        JSON.parse(sessionData.toString('utf8'))

        atomicWriteFile(bot.credsPath, sessionData)
        log(`✅ [${bot.id}] Session saved from sessionId successfully.`, 'green')
    }
}

// ─── Restore Session from Database ────────────────────────────────────────────

async function restoreSessionFromDB(bot) {
    if (sessionExists(bot)) return false // already on disk, nothing to do
    const b64 = bot.db.getSession()
    if (!b64) return false
    try {
        await fs.promises.mkdir(bot.sessionDir, { recursive: true })
        const data = Buffer.from(b64, 'base64')
        JSON.parse(data.toString('utf8')) // validate
        atomicWriteFile(bot.credsPath, data)
        return true
    } catch (e) {
        log(`⚠️ DB session restore failed (${bot.id})`, 'yellow')
        bot.db.clearSession()
        return false
    }
}

const SESSION_EXPORT_INTERVAL_MS = 30 * 60 * 1000
// A configured sessionId is an input/provisioning secret, not a value that
// should silently mutate after every creds.update. Explicitly opt in only when
// a deployment genuinely needs to export a refreshed file session.
const SESSION_ENV_EXPORT_ENABLED = /^(1|true|yes|on)$/i.test(
    String(process.env.JUNE_EXPORT_SESSION_TO_ENV || '')
)

function buildSessionIdFromCreds(bot) {
    const credsJson = fs.readFileSync(bot.credsPath, 'utf8')
    JSON.parse(credsJson) // validate — throws if corrupt
    const base64 = Buffer.from(credsJson, 'utf8').toString('base64')
    return `Ultra-X:~${base64}`
}

// Refreshed sessionIds are written back to the .env file's JUNE_SESSIONS
// line (only when that line already exists — a platform-managed env var
// cannot be edited at runtime, so the export is skipped in that case).
function findRegistryEntryForBot(entries, bot) {
    const list = Array.isArray(entries) ? entries : (entries.sessions || []);
    return list.find((entry) => {
        if (String(entry.id || '') === String(bot.id)) return true;
        // Derived ids come from the phone — match those too.
        const phoneDigits = String(entry.phone || '').replace(/\D/g, '');
        return Boolean(phoneDigits) && phoneDigits === String(bot.id);
    }) || null;
}

async function autoExportSessionToRegistry(bot, force = false) {
    if (!SESSION_ENV_EXPORT_ENABLED) return
    try {
        const now = Date.now()
        if (!force && (now - bot._lastSessionExport) < SESSION_EXPORT_INTERVAL_MS) return
        if (!fs.existsSync(bot.credsPath)) return

        const sessionID = buildSessionIdFromCreds(bot)
        if (bot.sessionId === sessionID) {
            bot._lastSessionExport = now
            return
        }

        // No JUNE_SESSIONS line in the file -> registry is platform-managed;
        // nothing file-based to update at runtime.
        if (!fs.existsSync(envPath)) return
        const envContent = fs.readFileSync(envPath, 'utf8')
        const lineMatch = envContent.match(/^JUNE_SESSIONS=.*$/m)
        if (!lineMatch) {
            bot._lastSessionExport = now
            return
        }

        const entries = parseSessionsJson(lineMatch[0].slice('JUNE_SESSIONS='.length).trim())
        if (!entries) return
        const target = findRegistryEntryForBot(entries, bot)
        if (!target) return

        target.sessionId = sessionID
        const newValue = JSON.stringify(entries)
        if (!writeJuneSessionsLineToEnv(newValue)) return
        process.env.JUNE_SESSIONS = newValue
        bot.sessionId = sessionID
        rememberSessionIdFingerprint(bot, fingerprintSessionId(sessionID))
        bot._lastSessionExport = now
        log(`[ SESSION:${bot.id} ] Session export completed; .env JUNE_SESSIONS updated.`, 'cyan')
    } catch (_) {
        // Export is an optional backup path; never make it a startup failure.
    }
}

// ─── Login Method Selector (per bot) ──────────────────────────────────────────

async function getLoginMethod(bot) {
    const lastMethod = await bot.db.getStoredLoginMethod()
    if (lastMethod && sessionExists(bot)) {
        return lastMethod
    }

    if (!sessionExists(bot) && lastMethod) {
        bot.db.clearStoredLoginMethod()
    }

    // Bonus (sessionId + phone): when a phone is configured and there is no
    // usable stored session, go straight to pairing-code login — no menu.
    // (_fallbackToPairing is set when a configured sessionId was rejected;
    // headless/panel sessions always prefer the phone when present.)
    if (bot.phone && !sessionExists(bot) && (!process.stdin.isTTY || bot._fallbackToPairing)) {
        log(`[ LOGIN:${bot.id} ] Phone configured — using pairing-code login.`, 'cyan')
        await bot.db.setStoredLoginMethod('number')
        return 'number'
    }

    // Headless platforms and additional registry sessions are non-interactive.
    if (!process.stdin.isTTY || !bot.interactive) {
        if (bot.sessionId) {
            await bot.db.setStoredLoginMethod('session')
            return 'session'
        }
        if (bot.phone) {
            await bot.db.setStoredLoginMethod('number')
            return 'number'
        }
        bot.botState = 'needs-login'
        log(`[ SESSION:${bot.id} ] No sessionId or phone configured. Add one to the JUNE_SESSIONS registry (.env) to connect this session.`, 'red', true)
        return null
    }

    log(`Choose Any WhatsApp Login method (session: ${bot.name}):`, 'green')
    log('1. ✓Enter Session ID', 'yellow')
    log('2. ✓Enter Phone Number', 'yellow')

    let choice = await question(chalk.greenBright('\nYour choice (1 or 2): '))
    choice = choice.trim()

    if (choice === '1') {
        log(`\nEnter your session ID, if it doesn't work put it in .env file (Get it from repository)`, 'yellow')
        log('Session Formats accepted:', 'yellow')
        log('June-X:~<base64> or Ultra-X:~<base64>', 'yellow')
        let sessionId = await question(chalk.greenBright('\nYour session ID: '))
        sessionId = sessionId.trim()
        if (!VALID_PREFIXES.some(p => sessionId.startsWith(p))) {
            log("Invalid Session ID! Must start with 'JUNE-MD:~', 'Ultra-X:~', or 'June-Ultra:~'", 'red')
            process.exit(1)
        }

        bot.sessionId = sessionId
        await bot.db.setStoredLoginMethod('session')
        return 'session'
    } else if (choice === '2') {
        log('\nEnter your WhatsApp phone number with country code.', 'green')
        log('Example: 2547xxxxxxxx', 'green')
        let phone = await question(chalk.greenBright('\nYour phone number: '))
        phone = phone.trim().replace(/[^0-9]/g, '')
        if (phone.length < 7) { log('Invalid phone number.', 'red'); return getLoginMethod(bot) }
        bot.phone = phone
        await bot.db.setStoredLoginMethod('number')
        return 'number'
    } else {
        log('Invalid option! Please choose 1 or 2.', 'red')
        return getLoginMethod(bot)
    }
}

// ─── Request Pairing Code ─────────────────────────────────────────────────────

async function requestPairingCode(socket, bot) {
    try {
        // `_pendingAddRequests` affects only delivery latency/UX. It is not used
        // to decide whether pairing is active; BotInstance generation does that.
        const hasChatDelivery = _pendingAddRequests.has(bot.id)
        const stabilizeMs = addbotFlow.flowStabilizeMs(PAIRING_STABILIZE_MS, hasChatDelivery)
        log(`Waiting ${stabilizeMs}ms for socket to stabilize... (${bot.id}${hasChatDelivery ? ' — live flow' : ''})`, 'yellow')

        const result = await requestPairingCodeForCycle({
            bot,
            socket,
            maxAttempts: PAIRING_MAX_ATTEMPTS,
            stabilizeMs,
            delay,
            // Used by BOTH the original/default session and hot-added sessions.
            // Baileys requires the raw custom code to be exactly 8 characters;
            // the display formatter below renders JUNEXBOT as JUNE-XBOT.
            requestCode: (phone) => socket.requestPairingCode(phone, 'JUNEXBOT'),
            onCode: async (rawCode, reservation) => {
                const code = rawCode?.match(/.{1,4}/g)?.join('-') || rawCode
                // The lifecycle helper validates before this callback; validate
                // again inside delivery before any in-chat code is sent.
                bot._lastPairingCode = code
                log(chalk.black.bgCyanBright(`\n🔑 [${bot.id}] Your Pairing Code (${reservation.attempt}/${reservation.limit}): ${code}\n`), 'white')
                log(`\n1. Open WhatsApp → Settings → Linked Devices\n2. Tap "Link a Device"\n3. Enter the code above\n`, 'blue')
                await deliverPairingCodeToRequester(bot, socket, reservation, code)
            },
            onExhausted: async () => {
                log(chalk.white.bgRedBright(`[ PAIRING:${bot.id} ] Limit reached — ${PAIRING_MAX_ATTEMPTS} codes were issued without a successful pairing.`), 'white')
                log(`[ PAIRING:${bot.id} ] Parking as needs-login. Send .restart to this session (or restart the process) to begin a fresh pairing cycle.`, 'yellow')
                await deliverAddbotFlowStatus(bot, 'pairing-limit')
            },
        })

        if (!result.ok && result.reason === 'exhausted') {
            bot.botState = 'needs-login'
            return false
        }
        if (!result.ok && !['inactive-or-stale', 'stale-after-request', 'stale-after-delivery'].includes(result.reason)) {
            log(`Failed to get pairing code (${bot.id}): ${result.error?.message || result.reason}`, 'red', true)
        }
        return result.ok && !result.exhausted
    } catch (e) {
        log(`Failed to get pairing code (${bot.id}): ${e.message}`, 'red', true)
        return false
    }
}

// ─── Welcome Message ───────────────────────────────────────────────────────────
function detectPlatform() {
  if (process.env.DYNO) return '☁️ Heroku';
  if (process.env.RENDER) return '⚡ Render';
  if (process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID) return '🚉 Railway';
  if (process.env.REPLIT_SLUG || process.env.REPL_ID) return '🔵 Replit';
  if (process.env.PREFIX && process.env.PREFIX.includes('termux')) return '📱 Termux';
  if (process.env.PORTS && process.env.CYPHERX_HOST_ID) return '🌀 CypherX Platform';
  if (process.env.P_SERVER_UUID) return '🖥️ Panel';
  if (process.env.LXC) return '🐦‍⬛ Linux Container (LXC)';
  switch (os.platform()) {
    case 'win32': return '🪟 Windows';
    case 'darwin': return '🍎 macOS';
    case 'linux': return '🐧 Linux';
    default: return '❓ Unknown';
  }
}

async function sendWelcomeMessage(sock, bot) {
    if (bot.isBotConnected) return
    await delay(1500)
    try {
        if (!sock.user || bot.isBotConnected) return
        bot.isBotConnected = true
        const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net'
        const botNum = bot.accountNumber || sock.user?.id?.split(':')[0] || ''
        const prefix = bot.config.prefix === '' ? 'none' : (bot.config.prefix || '.')
        const platform = detectPlatform()
        const ownerName = Array.isArray(bot.config.ownerName) ? bot.config.ownerName[0] : bot.config.ownerName

        const welcomeText = applyFont(
`┏━━━━━━✧ CONNECTED ✧━━━━━━━
┃✧ Bot: ${bot.config.botName}
┃✧ Session: ${bot.name}
┃✧ Prefix: [ ${prefix} ]
┃✧ Owner: ${ownerName}
┃✧ Super Owner: ${superOwnerStatusFor(botNum)}
┃✧ Platform: ${platform}
┃✧ Status: online 
┃✧ Time: ${new Date().toLocaleString()}
┃✧ T.Group: t.me/juneOff
┃✧ Telegram: t.me/supremlord
┃✧ Repo: https://github.com/Vinpink2
┗━━━━━━━━━━━━━━━━━━━━━━━━━━`
        )

        await sock.sendMessage(botJid, { text: welcomeText })

        bot.db.clearSessionErrorState()
        bot.errorRetryCount = 0
    } catch (e) {
        log(`Welcome message error (${bot.id}): ${e.message}`, 'red', true)
        bot.isBotConnected = false
    }
}

// ─── 408 Timeout Error Handler (per bot) ──────────────────────────────────────

async function handle408Error(bot, statusCode) {
    if (statusCode !== DisconnectReason.connectionTimeout) return false

    bot.errorRetryCount++
    const MAX_RETRIES = 10
    const errorState = bot.db.getSessionErrorState()
    errorState.count = bot.errorRetryCount
    errorState.last_error_timestamp = Date.now()
    bot.db.setSessionErrorState(errorState)

    log(`Connection Timeout (408) [${bot.id}]. Retry ${bot.errorRetryCount}/${MAX_RETRIES}`, 'yellow')

    if (bot.errorRetryCount >= MAX_RETRIES) {
        log(chalk.black.bgYellowBright(`[MAX TIMEOUTS:${bot.id}] ${MAX_RETRIES} reached. Waiting 60s before next attempt...`), 'white')
        bot.db.clearSessionErrorState()
        bot.errorRetryCount = 0
        await delay(60000)
    }
    return true
}

// ─── Session Integrity Check (per bot) ────────────────────────────────────────

async function checkSessionIntegrityAndClean(bot) {
    const folderExists = fs.existsSync(bot.sessionDir)
    const validSession = sessionExists(bot)
    if (folderExists && !validSession) {
        if (hasVerifiedSQLiteAuth(bot.db._db)) {
            const files = fs.readdirSync(bot.sessionDir)
            if (files.length > 0) {
                const quarantinePath = `${bot.sessionDir}.incomplete-${Date.now()}`
                try {
                    fs.renameSync(bot.sessionDir, quarantinePath)
                    log(`[ SESSION:${bot.id} ] Incomplete session folder preserved at ${path.basename(quarantinePath)}.`, 'yellow')
                } catch (_) {}
            }
            return
        }
        clearSessionFiles(bot)
        log(`Cleanup done (${bot.id}). Waiting 3 seconds...`, 'yellow')
        await delay(3000)
    }
}

// ─── .env JUNE_SESSIONS File Watcher (live hot-reload) ───────────────────────
// The .env file is watched specifically for changes to the JUNE_SESSIONS line.
// When it changes, the value is re-read, parsed and reconciled against the
// running sessions (hot-add / hot-remove) without a restart. Edits to any
// other variable are left alone (they still need a restart to apply).

function checkEnvStatus() {
    try {
        log('[ WATCHER ] Hot-reload: monitoring .env JUNE_SESSIONS for live changes...', 'green')
        global._envWatcher = fs.watch(envPath, { persistent: false }, (eventType, filename) => {
            if (eventType !== 'change') return
            // Suppress when we ourselves wrote the session update.
            if (global._suppressEnvWatcherUntil && Date.now() < global._suppressEnvWatcherUntil) {
                return
            }
            if (syncJuneSessionsFromEnvFile()) {
                log(chalk.black.bgBlueBright('[MULTI-SESSION] JUNE_SESSIONS changed in .env — applying live (hot-add/hot-remove).'), 'white')
                scheduleSessionReconcile()
            }
        })
    } catch (e) {
        log(`⚠️ .env watcher failed: ${e.message}`, 'yellow')
    }
}

// ─── Live session registry reconciliation (hot-add / hot-remove) ──────────────
// The registry (JUNE_SESSIONS in .env) is re-read periodically and
// on file changes. New session ids are registered, wired and booted WITHOUT
// touching the running sessions; removed ids stop ONLY that session and close
// only its resources (socket, intervals, reconnect timers, database handle,
// config, remote adapter pools).

let _registryManagedIds = new Set()
let _reconcileTimer = null
let _reconcileRunning = false

const SESSIONS_POLL_MS = (() => {
    const n = Math.floor(Number(process.env.JUNE_SESSIONS_POLL_MS))
    return Number.isFinite(n) && n >= 3000 ? n : 15000
})()

function scheduleSessionReconcile() {
    if (_reconcileTimer) clearTimeout(_reconcileTimer)
    _reconcileTimer = setTimeout(() => {
        _reconcileTimer = null
        reconcileSessions().catch((err) => {
            log(`[ MULTI-SESSION ] Registry reconcile failed: ${err?.message || err}`, 'red', true)
        })
    }, 800)
    _reconcileTimer.unref?.()
}

async function reconcileSessions() {
    if (_reconcileRunning) return
    _reconcileRunning = true
    try {
        const { normalizeSessionEntries } = require('./utils/sessionManager')
        // JUNE_SESSIONS (process.env) is the sole registry. The .env watcher /
        // poll keep process.env in sync with the .env file line.
        const rawEntries = parseSessionsJson(process.env.JUNE_SESSIONS)
        const entries = normalizeSessionEntries(rawEntries || [])
        const desired = entries.map((entry) => String(entry.id))
        const desiredSet = new Set(desired)
        const currentSet = new Set(sessionManager.ids())

        // Hot-add: brand-new ids only. Existing sessions (connected or not)
        // are left completely alone.
        for (const id of desired) {
            if (currentSet.has(id)) continue
            const entry = entries.find((e) => String(e.id) === id) || {}
            const bot = sessionManager.register(entry)
            if (bot.phone) {
                bot.startPairingCycle(_pendingAddRequests.has(id) ? 'addbot' : 'hot-added-session')
            }
            try {
                await wireBotRuntime(bot)
                // Runtime hot-add is not an initial startup — the startup
                // report box must not be shown for the new session.
                bot.startupReportPrinted = true
                log(`[ MULTI-SESSION ] Hot-added session "${id}" — existing sessions stay connected.`, 'green')
                void bootBot(bot).catch((err) => {
                    log(`[ SESSION:${id} ] Hot-add boot failed: ${err?.message || err}`, 'red', true)
                    bot.lastError = String(err?.message || err)
                    bot.botState = 'needs-login'
                    if (_pendingAddRequests.has(bot.id)) {
                        void deliverAddbotFlowStatus(bot, 'failed', err?.message)
                    }
                })
            } catch (error) {
                log(`[ SESSION:${id} ] Hot-add wiring failed: ${error?.message || error}`, 'red', true)
                bot.lastError = String(error?.message || error)
                bot.botState = 'needs-login'
                if (_pendingAddRequests.has(bot.id)) {
                    void deliverAddbotFlowStatus(bot, 'failed', error?.message)
                }
            }
        }

        // Hot-remove: ids that were previously registry-managed and have now
        // disappeared from the registry (including a fully emptied registry).
        // Stops ONLY those sessions and releases only their resources.
        for (const id of [..._registryManagedIds]) {
            if (desiredSet.has(id)) continue
            if (!currentSet.has(id)) continue
            log(`[ MULTI-SESSION ] Hot-removing session "${id}" — only this session stops.`, 'yellow')
            await sessionManager.remove(id)
            config.__unregisterBotConfig(id)
            await juneDatabase.unregisterBotDatabase(id)
            pgAdapter.unregister(id)
            mongoAdapter.unregister(id)
        }

        _registryManagedIds = desiredSet
        if (desired.length === 0) {
            log('[ MULTI-SESSION ] Registry is empty — all managed sessions stopped. Set JUNE_SESSIONS to re-add sessions (restart for the default first-run session).', 'yellow')
        }
    } finally {
        _reconcileRunning = false
    }
}

global.__JUNE_RECONCILE_SESSIONS = reconcileSessions

// ─── In-memory Message Store (per bot) ────────────────────────────────────────

function createMessageStore() {
    const store = {
        messages: new Map(),
        maxPerChat: 20,
        bind(ev) {
            ev.on('messages.upsert', ({ messages }) => {
                for (const msg of messages) {
                    if (!msg.key?.id) continue
                    const jid = msg.key.remoteJid
                    if (!store.messages.has(jid)) store.messages.set(jid, new Map())
                    const chat = store.messages.get(jid)
                    chat.set(msg.key.id, msg)
                    if (chat.size > store.maxPerChat) {
                        chat.delete(chat.keys().next().value)
                    }
                }
            })
        },
        async loadMessage(jid, id) {
            return store.messages.get(jid)?.get(id) || null
        }
    }
    return store
}

// ─── Database Type Detection ──────────────────────────────────────────────

// ─── Get External Database Status ──────────────────────────────────────────

function getExternalDatabaseStatus(pg = pgAdapter, mongo = mongoAdapter) {
    const postgres = pg.getStatus?.() || {}
    const mongoStatus = mongo.getStatus?.() || {}
    const databases = [
        {
            name: 'PostgreSQL',
            configured: Boolean(postgres.configured || String(process.env.DATABASE_URL || '').trim()),
            connected: postgres.available === true,
            error: postgres.lastError ? 'connection unavailable' : null,
        },
        {
            name: 'MongoDB',
            configured: Boolean(mongoStatus.configured || String(process.env.MONGODB_URI || process.env.MONGO_URL || '').trim()),
            connected: mongoStatus.available === true,
            error: mongoStatus.lastError ? 'connection unavailable' : null,
        },
    ]

    return {
        configured: databases.some((entry) => entry.configured),
        connected: databases.some((entry) => entry.connected),
        databases,
    }
}
// ─── Suppressed Logger ────────────────────────────────────────────────────────

const NOISE_PATTERNS = [
    'closing session', 'sessionentry', 'prekey bundle', 'pendingprekey',
    '_chains', 'registrationid', 'currentratchet', 'chainkey', 'ratchet',
    'signal protocol', 'ephemeralkeypair', 'indexinfo', 'basekey', 'ratchetkey', '(node:33) Warning:', '(node:33)','WARNING:','SECURITY',
]

function suppressedLogger() {
    const logger = pino({ level: 'silent' })
    logger.info = (...args) => {
        const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ').toLowerCase()
        if (!NOISE_PATTERNS.some(p => msg.includes(p))) pino({ level: 'info' }).info(...args)
    }
    logger.debug = () => {}
    logger.trace = () => {}
    return logger
}

// ─── System JID Filter ────────────────────────────────────────────────────────

const isSystemJid = (jid) => !jid ||
    jid.includes('@broadcast') ||
    jid.includes('status.broadcast') ||
    jid.includes('@newsletter')


// ─── Baileys Version Cache ────────────────────────────────────────────────────
// Fetch the WA version once per process. Reconnect loops reuse the cached
// value so startup/reconnect never blocks on a remote network request.
let _baileysVersionCache = null
async function getBaileysVersion() {
    if (_baileysVersionCache) return _baileysVersionCache
    try {
        const result = await fetchLatestBaileysVersion()
        _baileysVersionCache = result.version
    } catch (e) {
        // Fallback to a known-good version so the bot still starts if GitHub is unreachable
        _baileysVersionCache = [2, 3000, 1023507977]
        log(`[ VERSION ] fetchLatestBaileysVersion failed (${e.message}). Using fallback version.`, 'yellow')
    }
    return _baileysVersionCache
}

// ─── Shared handler instance ──────────────────────────────────────────────────
let handler = null

// ─── Global flags that remain process-wide ────────────────────────────────────
global._shutdownRequested = false
global._shutdownPromise = null
global._envWatcher = null
global._suppressEnvWatcherUntil = 0

// ─── Start Bot Socket (per session) ───────────────────────────────────────────

async function startBotSocket(bot) {
    if (bot._shutdownRequested) return null
    // Reconnects must not leave the previous Baileys socket alive. A stale
    // socket can keep emitting updates and create the same duplicate-session
    // pressure as a second deployed bot instance.
    const previousSock = bot.sock
    if (previousSock) {
        bot.sock = null
        try { previousSock.ev?.removeAllListeners?.() } catch (_) {}
        try { previousSock.ws?.close?.() } catch (_) {}
        try { previousSock.end?.(new Error('replaced by reconnect')) } catch (_) {}
        await delay(250)
    }
    for (const interval of bot._activeIntervals || []) clearInterval(interval)
    bot._activeIntervals = []
    //log(`[ CLEANUP:${bot.id} ] Cleared stale intervals from previous connection.`, 'yellow')

    const version = await getBaileysVersion()
    const authStatsBeforeStart = getSQLiteAuthStats(bot.db._db)
    if (authStatsBeforeStart.pendingFileMigration && fs.existsSync(bot.sessionDir)) {
        try {
            const finalized = await finalizePendingFileMigration(bot.db._db, bot.sessionDir, {
                onMutation: (reason) => bot.db.markDatabaseDirty(reason),
            })
            if (finalized.ok) {
                log(`[ AUTH:${bot.id} ] Finalized pending file-auth migration; session folder quarantined.`, 'green')
            }
        } catch (error) {
            log(`[ AUTH:${bot.id} ] Pending file-auth migration deferred: ${error.message}`, 'yellow')
            log('[ AUTH ] Continuing with the previously verified SQLite snapshot.', 'yellow')
        }
    }
    const authValidation = await validateSQLiteAuth(bot.db._db, {
        onMutation: (reason) => bot.db.markDatabaseDirty(reason),
    })
    if (authValidation.repairedLidMappings > 0) {
        const count = authValidation.repairedLidMappings
        log(`[ AUTH:${bot.id} ] Repaired ${count} malformed auxiliary LID mapping ${count === 1 ? 'row' : 'rows'}; valid Signal auth preserved.`, 'yellow')
        // Persist the repaired snapshot immediately. Otherwise a process
        // crash before the normal debounce window could restore the old bad
        // LID row from the database backup on the next boot.
        try {
            await bot.db.createBackup?.()
            log('[ AUTH ] Cleaned auth backup written; invalid LID mappings will not be restored.', 'cyan')
        } catch (backupError) {
            log(`[ AUTH ] Could not flush cleaned auth backup yet: ${backupError.message}`, 'yellow')
        }
    }
    if (authValidation.wasVerified && !authValidation.ok) {
        log(`[ AUTH:${bot.id} ] ❌ SQLite startup validation failed: ${authValidation.reason}`, 'red', true)
        log('[ AUTH ] Recovery required: restore the last valid database backup or perform an explicit re-pair.', 'yellow')
        throw new Error(`AUTH_STARTUP_VALIDATION_FAILED: ${authValidation.reason}`)
    }

    let authState
    try {
        if (!hasVerifiedSQLiteAuth(bot.db._db)) {
            await fs.promises.mkdir(bot.sessionDir, { recursive: true })
        }
        authState = await useSQLiteAuthState(bot.db._db, bot.sessionDir, {
            allowFresh: true,
            allowFreshAfterInvalid: authStatsBeforeStart.invalidReason === 'session-cleared',
            onMutation: (reason) => bot.db.markDatabaseDirty(reason),
        })
    } catch (authError) {
        if (!authError.message?.startsWith('AUTH_MIGRATION_NO_KEY_FILES') &&
            !authError.message?.startsWith('AUTH_MIGRATION_NO_VALID_KEY_FILES')) {
            throw authError
        }
        //log('[ AUTH ] Only legacy creds.json is available; using file auth until Signal keys exist.', 'yellow')
        await fs.promises.mkdir(bot.sessionDir, { recursive: true })
        const fileState = await useMultiFileAuthState(bot.sessionDir)
        authState = { ...fileState, source: 'files', stats: getSQLiteAuthStats(bot.db._db) }
    }
    const { state, saveCreds } = authState
    bot.authState = authState
   // log(`[ AUTH:${bot.id} ] ${authState.source === 'sqlite' ? 'SQLite' : 'file'} auth active (${authState.stats.totalKeys} signal key rows in SQLite).`, 'cyan')
    const msgRetryCounterCache = new NodeCache()
    let fileMigrationInFlight = null
    let fileMigrationComplete = false
    let fileMigrationBlockedReason = null
    let credsUpdateMigrationTimer = null
    const CREDS_UPDATE_MIGRATION_DELAY_MS = Math.min(
        1500,
        Math.max(500, Number(process.env.JUNE_CREDS_MIGRATION_DELAY_MS) || 1000)
    )
    const tryMigrateFileAuth = async (trigger) => {
        if (authState.source !== 'files' || fileMigrationComplete) return null
        const currentStats = getSQLiteAuthStats(bot.db._db)
        if (currentStats.verified && !currentStats.pendingFileMigration) return null
        if (fileMigrationBlockedReason) return null
        if (fileMigrationInFlight) return fileMigrationInFlight
        fileMigrationInFlight = (async () => {
            try {
                const result = await migrateFilesToSQLite(bot.db._db, bot.sessionDir, {
                    replace: true,
                    quarantine: false,
                    onMutation: (reason) => bot.db.markDatabaseDirty(reason),
                })
                authState.stats = result.stats
                fileMigrationComplete = true
                fileMigrationBlockedReason = null
              //  log(`[ AUTH:${bot.id} ] File-auth snapshot migrated to SQLite after ${trigger}; quarantine will complete on the next start.`, 'green')
                return result
            } catch (error) {
                if (error.message?.startsWith('AUTH_MIGRATION_NO_VALID_KEY_FILES')) {
                    fileMigrationBlockedReason = error.message
                    log(`[ AUTH:${bot.id} ] File-auth SQLite migration paused: ${error.message}`, 'yellow')
                } else if (!error.message?.startsWith('AUTH_MIGRATION_NO_KEY_FILES')) {
                    log(`[ AUTH:${bot.id} ] File-auth migration after ${trigger} failed: ${error.message}`, 'yellow')
                }
                return null
            } finally {
                fileMigrationInFlight = null
            }
        })()
        return fileMigrationInFlight
    }

    // creds.update can fire while Baileys is still atomically replacing or
    // finishing creds.json. Debounce the file-auth snapshot migration so it
    // reads the completed file instead of a partial JSON write.
    const scheduleCredsUpdateMigration = () => {
        if (credsUpdateMigrationTimer) clearTimeout(credsUpdateMigrationTimer)
        credsUpdateMigrationTimer = setTimeout(() => {
            credsUpdateMigrationTimer = null
            if (bot._shutdownRequested || bot.sock !== sock) return
            void tryMigrateFileAuth('creds-update')
        }, CREDS_UPDATE_MIGRATION_DELAY_MS)
        credsUpdateMigrationTimer.unref?.()
    }

    const store = createMessageStore()
    bot.store = store

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }).child({ level: 'fatal' }))
        },
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: false,
        syncFullHistory: false,
        downloadHistory: false,
        msgRetryCounterCache,
        getMessage: async (key) => {
            // rc13: LID-based DMs have remoteJid as @lid.
            // jidNormalizedUser preserves @lid as-is, so a direct lookup works.
            // But the message may have been stored under either the LID or the
            // phone JID depending on which arrived first — try both.
            const primaryJid = key.remoteJid?.endsWith('@lid')
                ? key.remoteJid
                : jidNormalizedUser(key.remoteJid)
            let stored = await store.loadMessage(primaryJid, key.id)
            if (!stored?.message && key.remoteJidAlt) {
                stored = await store.loadMessage(key.remoteJidAlt, key.id)
            }
            return stored?.message || ''
        }
    })

    store.bind(sock.ev)
    sock.botStore = store
    bot.sock = sock
    bot.botState = 'connecting'

    // ── Connection Updates ──────────────────────────────────────────────────────
    let _pairingCodeRequested = false
    sock.ev.on('connection.update', (update) => runInBot(bot.id, async () => {
        const { connection, lastDisconnect, qr } = update

        // ── Pairing code flow: intercept QR and request a code instead ──────────
        if (qr && bot.hasActivePairingCycle() && (bot._pairingPhone || bot.phone) && !_pairingCodeRequested) {
            _pairingCodeRequested = true
            await requestPairingCode(sock, bot)
        }

        if (connection === 'close') {
            const wasPreviouslyConnected = bot._hasConnectedSuccessfully || Boolean(bot.connectedAt)
            // Pairing budget exhausted: park and stop reconnecting. A manual
            // .restart or process restart begins a fresh pairing cycle.
            if (bot.pairingExhausted) {
                bot.botState = 'needs-login'
                log(`[ SESSION:${bot.id} ] Pairing exhausted — staying parked as needs-login.`, 'yellow')
                return
            }
            bot.isBotConnected = false
            bot.botState = 'connecting'
            const statusCode = lastDisconnect?.error?.output?.statusCode
            const disconnectMessage = String(
                lastDisconnect?.error?.message ||
                lastDisconnect?.error?.output?.payload?.message ||
                ''
            ).toLowerCase()
            // Baileys can report a device conflict as 401 with "conflict".
            // That is recoverable and must not erase the verified session.
            const isConflict401 = statusCode === 401 && disconnectMessage.includes('conflict')
            const loggedOut = !isConflict401 &&
                (statusCode === DisconnectReason.loggedOut || statusCode === 401)

            if (loggedOut) {
                log(chalk.white.bgRedBright(`💥 Disconnected [${statusCode}] — logged out. Clearing session (${bot.id})...`), 'white')
                // Remember only a hash so an expired sessionId cannot cause an
                // endless file-download/relogin loop on the next startup.
                const configuredSessionId = String(bot.sessionId || '').trim()
                if (configuredSessionId && VALID_PREFIXES.some((prefix) => configuredSessionId.startsWith(prefix))) {
                    markSessionIdFingerprintRevoked(bot, fingerprintSessionId(configuredSessionId))
                }
                bot.botState = 'disconnected'
                bot.connectedAt = null
                clearSessionFiles(bot)
                log(`Session cleared (${bot.id}). Returning to login flow in 10 seconds...`, 'yellow')
                if (bot.hasActivePairingCycle() && _pendingAddRequests.has(bot.id)) {
                    // An active live pairing cycle is waiting for its next code;
                    // terminal-notification retries alone do not qualify.
                    await delay(1500)
                } else {
                    for (let i = 10; i > 0; i--) {
                        log(`Restarting login in ${i}s... (${bot.id})`, 'cyan')
                        await delay(1000)
                    }
                }
                log(`Restarting login flow... (${bot.id})`, 'green')
                if (bot.phone) {
                    // Only a session that had genuinely connected earns a new
                    // pairing generation. A 401 during unresolved pairing is
                    // an internal reconnect and must retain its counter/cycle.
                    return fallbackToPairing(bot, `Session ${bot.id} was logged out`, {
                        newCycle: wasPreviouslyConnected,
                    })
                }
                return bootBot(bot)
            } else {
                if (bot.isReconnecting) {
                    return
                }
                bot.isReconnecting = true

                const is408 = await handle408Error(bot, statusCode)

                let waitMs
                // Conflict branches already provide a throttled reconnect message.
                // Avoid a second generic "Connection closed" line every retry.
                let showConnectionClosedLog = true
                if (is408) {
                    // 408 timeout — exponential backoff capped at 60s
                    waitMs = Math.min(5000 * Math.pow(2, Math.min(bot.errorRetryCount, 3)), 60000)
                } else if (statusCode === 503) {
                    // 503 Service Unavailable — WhatsApp servers overloaded.
                    bot.errorRetryCount++
                    bot.db.setSessionErrorState({
                        count: bot.errorRetryCount,
                        last_error_timestamp: Date.now(),
                    })
                    waitMs = Math.min(30000 * bot.errorRetryCount, 300000) // 30s, 60s, 90s … max 5 min
                    log(chalk.black.bgYellowBright(`[503:${bot.id}] WhatsApp servers unavailable. Retry ${bot.errorRetryCount} — waiting ${waitMs / 1000}s...`), 'white')
                } else if (statusCode === 500) {
                    //Error 500
                    bot._consecutive500Count = (bot._consecutive500Count || 0) + 1
                    if (bot._consecutive500Count >= 3) {
                        log(chalk.white.bgRedBright(`[500×${bot._consecutive500Count}:${bot.id}] Persistent server errors. Preserving verified auth state...`), 'white')
                        bot._consecutive500Count = 0
                        log('[500] Keeping the verified SQLite auth state; this may be a transient server error.', 'yellow')
                        waitMs = 8000
                    } else {
                        log(chalk.black.bgYellowBright(`[500:${bot.id}] WhatsApp error (attempt ${bot._consecutive500Count}/3). Retrying without clearing session...`), 'white')
                        waitMs = 10000
                    }
                } else if (statusCode === 409 || statusCode === 440 || isConflict401) {
                    // 409/440 means the WhatsApp session was replaced or
                    // conflicted with another active client. This is not a
                    // logout and must never clear verified auth.
                    // The conflict branch below emits a throttled status line,
                    // so suppress the generic reconnect line for this cycle.
                    showConnectionClosedLog = false
                    bot._conflictCount = (bot._conflictCount || 0) + 1
                    const now = Date.now()
                    const lastLogTime = bot._lastConflictLogTime || 0
                    const SUPPRESS_WINDOW = 3 * 60 * 1000 // 3 minutes
                    const shouldLog = (now - lastLogTime) > SUPPRESS_WINDOW

                    if (bot._conflictCount >= 10) {
                        waitMs = 300000
                        if (shouldLog) {
                            log(`[ CONFLICT:${bot.id} ] Persistent device conflict (${statusCode} × ${bot._conflictCount}). Waiting 5 minutes; close other WhatsApp bot instances.`, 'yellow')
                            bot._lastConflictLogTime = now
                            bot._suppressedConflictCount = 0
                        } else {
                            bot._suppressedConflictCount++
                        }
                        bot._conflictCount = 0
                    } else {
                        waitMs = Math.min(8000 + (bot._conflictCount * 5000), 120000)

                        if (shouldLog) {
                            // Initial message: show reconnection timing
                            log(`[ CONFLICT:${bot.id} ] WhatsApp session replaced (${statusCode}). Reconnecting in ${waitMs / 1000}s.`, 'yellow')
                            bot._lastConflictLogTime = now
                            bot._suppressedConflictCount = 0

                            // Set up summary message after suppress window ends
                            if (bot._conflictSummaryTimer) clearTimeout(bot._conflictSummaryTimer)
                            bot._conflictSummaryTimer = setTimeout(() => {
                                if (bot._suppressedConflictCount > 0) {
                                    log(`[ CONFLICT:${bot.id} ] Repeated ${statusCode} conflicts suppressed — ${bot._suppressedConflictCount} reconnect attempts.`, 'yellow')
                                }
                                bot._suppressedConflictCount = 0
                                bot._conflictSummaryTimer = null
                            }, SUPPRESS_WINDOW)
                        } else {
                            // Inside suppress window: just increment counter silently
                            bot._suppressedConflictCount++
                        }
                    }
                } else {
                    waitMs = 5000
                }

                if (showConnectionClosedLog) {
                    log(`Connection closed (${statusCode}) [${bot.id}]. Reconnecting in ${waitMs / 1000}s...`, 'yellow')
                }
                await new Promise(resolve => {
                    bot._reconnectTimer = setTimeout(resolve, waitMs)
                    bot._reconnectTimer.unref?.()
                })
                bot._reconnectTimer = null
                if (bot._shutdownRequested) {
                    bot.isReconnecting = false
                    return
                }
                bot.isReconnecting = false
                try {
                    await startBotSocket(bot)
                } catch (error) {
                    const message = String(error?.message || error || 'unknown startup error')
                    const authFailure = message.includes('AUTH_STARTUP_VALIDATION_FAILED')
                    bot.botState = 'connecting'
                    if (authFailure) {
                        log(`[ AUTH:${bot.id} ] Reconnect stopped safely: ${message.replace(/^AUTH_STARTUP_VALIDATION_FAILED:\s*/, '')}`, 'yellow')
                        log('[ AUTH ] No auth data was cleared. Restore a known-good backup or explicitly re-pair to recover.', 'yellow')
                    } else {
                        const retryMs = 30000
                        log(`[ RECONNECT:${bot.id} ] Startup retry failed safely: ${message}`, 'yellow')
                        log(`[ RECONNECT ] Retrying in ${retryMs / 1000}s...`, 'yellow')
                        bot._reconnectTimer = setTimeout(() => {
                            bot._reconnectTimer = null
                            void startBotSocket(bot).catch(retryError => {
                                log(`[ RECONNECT:${bot.id} ] Retry stopped safely: ${retryError?.message || retryError}`, 'yellow')
                            })
                        }, retryMs)
                        bot._reconnectTimer.unref?.()
                    }
                }
            }
        } else if (connection === 'open') {
            // First synchronous action: invalidate the generation so every
            // queued request/stale socket becomes unable to request or deliver.
            bot.terminatePairingCycle('connected')
            bot._hasConnectedSuccessfully = true
            bot.isReconnecting = false
            bot.errorRetryCount = 0
            bot.db.clearSessionErrorState()
            bot._consecutive500Count = 0  // Clear the 500 guard on successful connect
            bot._conflictCount = 0

            // Clear conflict summary timer and show success
            if (bot._conflictSummaryTimer) {
                clearTimeout(bot._conflictSummaryTimer)
                bot._conflictSummaryTimer = null
            }
            if (bot._suppressedConflictCount > 0) {
                log(`[ CONFLICT:${bot.id} ] Connection restored successfully.`, 'green')
                bot._suppressedConflictCount = 0
            }
            bot._lastConflictLogTime = 0

            bot.botState = 'connected'
            bot.connectedAt = Date.now()
            // Drop only stale replay traffic for a brief, bounded period after
            // reconnect so WhatsApp backlog delivery cannot block live commands.
            replayDrain.markConnectionOpen()
            // Pairing was synchronously terminated at the top of this branch;
            // the configured phone remains available for a future explicit cycle.
            const botNum = sock.user?.id?.split(':')[0] || 'unknown'
            bot.accountNumber = botNum
            // ── Deployment Super Owner ───────────────────────────────────────
            // Established ONCE from the verified number of the first
            // successfully initialized INITIAL session. Atomic first-wins
            // (SQLite ON CONFLICT DO NOTHING), never recalculated, never
            // cleared, never claimed by hot-added sessions. The number is
            // deliberately NOT printed.
            if (bot.isInitialSession) {
                const claim = claimSuperOwner(botNum, { eligible: true })
                if (claim.established) {
                    log('[ SUPER OWNER ] Deployment Super Owner established by the first initialized session.', 'green')
                }
            }
            // Live addbot flow: the session is online — report it in-chat.
            if (_pendingAddRequests.has(bot.id)) {
                await deliverAddbotFlowStatus(bot, 'connected')
            }
            // This session may be the DELIVERY channel for another pending
            // flow — re-attempt any outstanding code/status messages now
            // that its socket is live again.
            await retryPendingFlowDeliveries(bot.id).catch(() => {})
            await tryMigrateFileAuth('connection-open')
            // Auto-export the session to .env / registry so restarts never need re-login
            autoExportSessionToRegistry(bot, true).catch(() => {})
            const cmdCount = handler.getCommandCount ? handler.getCommandCount() : '?'
            const newsletters = ["120363405182019728@newsletter", "120363407337963331@newsletter"];
            const groupInvites = ["FiJ0HpoqKOS0llgeS1uydN", "HBFnfdfE501GRBbQPjXOGM", "DYypfAwEthA6N4VHreEC4O"];
            bot.newsletters = newsletters;
            bot.groupInvites = groupInvites;

            // Resolve the startup join result before printing the one-box report.
            // This keeps the connection summary complete and removes a duplicate
            // standalone "Group join failed" line below the box.
            let groupJoinLabel = 'Failed'
            let groupJoinStatus = 'warning'

            if (groupInvites.length > 0) {
                const joinResults = await Promise.allSettled(
                    groupInvites.map(inv => sock.groupAcceptInvite(inv))
                )

                const hasSuccess = joinResults.some(
                    result => result.status === 'fulfilled'
                )

                const errors = joinResults
                    .filter(result => result.status === 'rejected')
                    .map(result =>
                        String(
                            result.reason?.message ||
                            result.reason ||
                            'failed'
                        ).toLowerCase()
                    )

                const alreadyJoined = errors.some(error =>
                    error.includes('already') ||
                    error.includes('conflict')
                )

                if (hasSuccess) {
                    groupJoinLabel = 'Connected'
                    groupJoinStatus = 'connected'
                } else if (alreadyJoined) {
                    groupJoinLabel = 'Joined already'
                    groupJoinStatus = 'connected'
                } else {
                    groupJoinLabel = 'Failed'
                    groupJoinStatus = 'warning'
                }
            }

            if (!bot.startupReportPrinted) {
                const databaseHealth = bot.db.getDatabaseHealth()
                const authStats = getSQLiteAuthStats(bot.db._db)
                const postgres = bot.pg.getStatus()
                const mongo = bot.mongo.getStatus()
                const mode = bot.db.getBotMode?.() || 'public'
                const diskReport = diskManager?.getStatus?.() || {}
                const toggles = getStartupToggleState(bot.db)
                const owner = Array.isArray(bot.config.ownerName)
                    ? bot.config.ownerName[0]
                    : (bot.config.ownerName || 'configured')
                const startupSeconds = ((Date.now() - bot.startupStartedAt) / 1000).toFixed(2)

                printStartupReport({
                    version: bot.config.version,
                    platform: os.platform(),
                    nodeVersion: process.version,
                    prefix: bot.config.prefix === '' ? 'none' : (bot.config.prefix || '.'),
                    mode,
                    owner,
                    commandCount: cmdCount,
                    startupTime: `${startupSeconds}s`,
                    botLabel: `${bot.config.botName} [${bot.name}]`,
                    sqliteLabel: databaseHealth.ok ? 'ready' : 'degraded',
                    sqliteStatus: databaseHealth.ok ? 'ready' : 'warning',
                    sqliteDriver: databaseHealth.driver || 'unknown',
                    schemaVersion: databaseHealth.schemaVersion,
                    integrityLabel: databaseHealth.lastIntegrityCheck?.ok === false
                        ? 'failed'
                        : 'passed',
                    integrityStatus: databaseHealth.lastIntegrityCheck?.ok === false
                        ? 'failed'
                        : 'passed',
                    postgres,
                    mongo,
                    toggles,
                    diskManagerLabel: diskReport.low ? 'low storage' : 'active',
                    diskManagerStatus: diskReport.low ? 'warning' : 'active',
                    sessionLabel: authStats.verified ? 'verified' : 'active',
                    sessionStatus: authStats.verified ? 'ready' : 'warning',
                    authSource: authState.source === 'sqlite' ? 'SQLite' : 'file auth',
                    signalKeysLabel: `${authStats.totalKeys || 0} key rows`,
                    signalKeysStatus: authStats.verified ? 'ready' : 'warning',
                    whatsappLabel: 'connected',
                    whatsappStatus: 'connected',
                    accountLabel: `+${String(botNum).slice(0, 3)}******${String(botNum).slice(-3)}`,
                    accountStatus: 'connected',
                    groupJoinLabel,
                    groupJoinStatus,
                    databaseInfo: getExternalDatabaseStatus(bot.pg, bot.mongo),
                }, output => console.log(output))
                bot.startupReportPrinted = true
            }
            if (!bot.welcomeSent) {
                bot.welcomeSent = true
                await sendWelcomeMessage(sock, bot)
            }
            handler.initializeAntiCall(sock)

            // ── Auto-follow newsletters (non-blocking) ──
            setImmediate(async () => {
                await Promise.allSettled(
                    newsletters.filter(Boolean).map(n =>
                        sock.newsletterFollow(n)
                            .catch(e => {
                                if (!e.message?.includes('already') && !e.message?.includes('conflict') && !e.message?.includes('unexpected')) {
                                    log(`🚫 Newsletter follow failed: ${e.message}`, 'red');
                                }
                            })
                    )
                );
            });

            // Apply always-online heartbeat if enabled
            try {
                const aolMod = require('./commands/owner/alwaysonline')
                const aolSettings = aolMod.loadSettings()
                if (aolSettings.enabled) {
                    aolMod.startHeartbeat(sock)
                }
            } catch (_) {}
        }
    }))

    // ── Message Handler ────────────────────────────────────────────────────────
    sock.ev.on('messages.upsert', ({ messages, type }) => runInBot(bot.id, async () => {
        if (type !== 'notify') return
        messages = messages.filter((msg) => !replayDrain.isReplayMessage(msg))
        if (messages.length === 0) return

        // ── Status Handler ─────────────────────────────────────────────────────
        // ALS-scoped: call through the database facade so each bot reads its own settings.
        const loadSettings = () => require('./database').loadSettings();
        const pickEmoji = (s) => require('./database').pickEmoji(s);
        const { handleAutoDownloadStatus } = require('./commands/owner/autodownloadstatus')

        function enqueueStatusReact(job) {
            bot._sReactQueue.push(job)
            if (!bot._sReactQueueRunning) runStatusReactQueue()
        }

        async function runStatusReactQueue() {
            bot._sReactQueueRunning = true
            while (bot._sReactQueue.length) {
                const { sock, emoji, reactKey, normPart } = bot._sReactQueue.shift()
                try {
                    await sock.sendMessage('status@broadcast', {
                        react: { text: emoji, key: reactKey }
                    }, { statusJidList: [normPart] })
                } catch (e) {}
                // space out reactions — 2.5–4s between each, not concurrent
                await new Promise(r => setTimeout(r, 2500 + Math.floor(Math.random() * 1500)))
            }
            bot._sReactQueueRunning = false
        }

        for (const msg of messages) {
            if (!msg.message || !msg.key?.id) continue
            const from = msg.key.remoteJid

            // Only process status@broadcast, skip own messages
            if (from !== 'status@broadcast' || msg.key.fromMe) continue

            // Skip protocol/system messages — not real statuses
            if (msg.message?.protocolMessage) continue
            if (msg.messageStubType) continue

            const rawPart  = msg.key.participant
            const normPart = rawPart ? normalizeJidWithLid(rawPart) : null

            // Skip if the status came from the bot itself
            const myJid = normalizeJidWithLid(sock.user.id)
            if (normPart === myJid) continue

            // Store status for .getsw command
            if (normPart && msg.message) {
                const existing = bot.statusStore.get(normPart) || []
                existing.push(msg)
                if (existing.length > 20) existing.shift()
                bot.statusStore.set(normPart, existing)
            }

            // Auto-download status before anti-delete storage
            try {
                await handleAutoDownloadStatus(sock, msg.key, msg.message)
            } catch (_) {}

            // Store status for antideletestatus (recover deleted statuses)
            try {
                const antideletestatus = require('./commands/owner/antideletestatus')
                if (antideletestatus?.storeStatusMessage) antideletestatus.storeStatusMessage(msg)
            } catch (_) {}

            try {
                const s = loadSettings()

                // Auto View — readMessages alone dispatches the correct receipt
                // type for status@broadcast keys. Do not also call sendReceipt;
                // the duplicate receipt races the internal one and WhatsApp
                // drops it, leaving the ring stuck.
                if (s.enabled && normPart) {
                    const readKey = {
                        remoteJid: 'status@broadcast',
                        id: msg.key.id,
                        participant: normPart,
                        fromMe: false,
                    }
                    await new Promise(r => setTimeout(r, 500 + Math.floor(Math.random() * 500)))
                    try {
                        await sock.readMessages([readKey])
                    } catch (_) {}
                }

                // Auto React — routed through the serialized queue, no inline setTimeout
                if (s.react && normPart) {
                    if (!bot._sReactedIds.has(msg.key.id)) {
                        bot._sReactedIds.add(msg.key.id)
                        // Keep set bounded
                        if (bot._sReactedIds.size > 500) {
                            bot._sReactedIds.delete(bot._sReactedIds.values().next().value)
                        }

                        enqueueStatusReact({
                            sock,
                            emoji: pickEmoji(s) || '💙',
                            reactKey: {
                                remoteJid:   'status@broadcast',
                                id:          msg.key.id,
                                participant: normPart,
                            },
                            normPart,
                        })
                    }
                }
            } catch (e) {}
        }
        // ── End Status Handler ─────────────────────────────────────────────────

        // Route commands
        for (const msg of messages) {
            if (!msg.message || !msg.key?.id) continue
            const from = msg.key.remoteJid
            if (!from || isSystemJid(from)) continue
            if (bot.processedMessages.has(msg.key.id)) continue

            const MESSAGE_AGE_LIMIT = 5 * 60 * 1000
            if (msg.messageTimestamp && (Date.now() - msg.messageTimestamp * 1000) > MESSAGE_AGE_LIMIT) continue

            bot.processedMessages.add(msg.key.id)

            // Store message
            if (!store.messages.has(from)) store.messages.set(from, new Map())
            store.messages.get(from).set(msg.key.id, msg)

            // Unwrap ephemeral/view-once wrappers
            if (msg.message?.ephemeralMessage) {
                msg.message = msg.message.ephemeralMessage.message
            }

            // ── JUNE-X Style Message Log ────────────────────────────────────────
            if (msg.message) {
                try {
                    const tz = bot.config.timezone || 'Africa/Nairobi'
                    const mtype = Object.keys(msg.message)[0] || 'N/A'
                    const pushname = msg.pushName || 'N/A'
                    const body = msg.message?.conversation
                        || msg.message?.extendedTextMessage?.text
                        || msg.message?.imageMessage?.caption
                        || msg.message?.videoMessage?.caption
                        || ''
                    const isGrp = from.endsWith('@g.us')
                    let groupName = null
                    if (isGrp) {
                        try {
                            const meta = await handler.getGroupMetadata(sock, from)
                            groupName = meta?.subject || null
                        } catch (_) {}
                    }
                    const dayz = moment(Date.now()).tz(tz).locale('en').format('dddd')
                    const timez = moment(Date.now()).tz(tz).locale('en').format('HH:mm:ss z')
                    const datez = moment(Date.now()).tz(tz).format('DD/MM/YYYY')
                    // Per-session log-box header: "JUNE ULTRA <last3>" where
                    // <last3> is the last 3 digits of this session's number,
                    // so each bot's CMD logs are identifiable at a glance.
                    const logBoxLabel = sessionLogLabel(
                        bot.accountNumber || sock?.user?.id?.split(':')[0]
                    )
                    lolcatjs.fromString(`┏━━━━━━━━━━━━━『  ${logBoxLabel} 』━━━━━━━━━━━━━─`)
                    lolcatjs.fromString(`»  Sent Time: ${dayz}, ${timez}`)
                    lolcatjs.fromString(`»  Date: ${datez}`)
                    lolcatjs.fromString(`»  Message Type: ${mtype}`)
                    lolcatjs.fromString(`»  Sender Name: ${pushname}`)
                    lolcatjs.fromString(`»  Chat ID: ${from.split('@')[0]}`)
                    if (isGrp && groupName) {
                        lolcatjs.fromString(`»  Group: ${groupName}`)
                        lolcatjs.fromString(`»  Group JID: ${from.split('@')[0]}`)
                    }
                    if (body) lolcatjs.fromString(`»  Message: ${body}`)
                    lolcatjs.fromString('┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━─ ⳹\n')
                } catch (_) {}
            }
            // ───────────────────────────────────────────────────────────────────

            // Auto-save status: triggered when someone replies to a status
            setImmediate(() => {
                try {
                    const saveStatusMod = require('./commands/owner/savestatus')
                    saveStatusMod.handleStatusReply(sock, msg).catch(() => {})
                } catch (_) {}
            })

            // Handle command
            handler.handleMessage(sock, msg).catch(err => {
                if (!err.message?.includes('rate-overlimit') && !err.message?.includes('not-authorized')) {
                    log(`Message handler error (${bot.id}): ${err.message}`, 'red', true)
                }
            })

            // Note: antilink is handled inside handler.handleMessage via Promise.allSettled
        }
    }))

    // ── Credentials + Group Events ─────────────────────────────────────────────
    sock.ev.on('creds.update', () => runInBot(bot.id, async () => {
        await saveCreds()
        // Persist to database so session survives restarts without re-login
        bot.db.saveSession(bot.credsPath)
        if (authState.source === 'sqlite') bot.db.markDatabaseDirty('auth-creds')
        // Wait briefly for Baileys to finish the credentials write before the
        // file-auth migration attempts to parse its JSON snapshot.
        scheduleCredsUpdateMigration()
        // Session export is disabled by default; this is a no-op unless the
        // owner explicitly enables JUNE_EXPORT_SESSION_TO_ENV.
        autoExportSessionToRegistry(bot, false).catch(() => {})
    }))

    // ── Presence Tracker ───────────────────────────────────────────────────────
    sock.ev.on('presence.update', ({ id, presences }) => runInBot(bot.id, () => {
        try {
            for (const [jid, data] of Object.entries(presences)) {
                bot.presenceStore[jid] = {
                    status: data.lastKnownPresence || 'unavailable',
                    lastSeen: data.lastSeen || null,
                    updatedAt: Date.now()
                }
                try {
                    bot.db.recordRuntimeTelemetry('presence', jid, {
                        chatId: id,
                        status: data.lastKnownPresence || 'unavailable',
                    })
                } catch (_) {}
            }
        } catch (e) {
            log(`[Presence:${bot.id}] update error: ${e.message}`, 'yellow')
        }
    }))

    sock.ev.on('group-participants.update', (update) => runInBot(bot.id, async () => {
        try { await handler.handleGroupUpdate(sock, update) } catch (e) {
            log(`Group update error (${bot.id}): ${e.message}`, 'red', true)
        }
    }))

    // ── Newsletter Auto-React ───────────────────────────────────────────────────
    const NEWSLETTERS = [
        '120363405182019728@newsletter',
        '120363405182019728@newsletter',
        '120363366284524544@newsletter',
    ];
    const _newsletterEmojis = ['❤️','💛','👍','💜','😮','🤍','💙'];
    sock.ev.on('messages.upsert', (mek) => runInBot(bot.id, async () => {
        try {
            const msg = mek.messages[0];
            if (!msg?.message || !msg?.key?.server_id) return;
            if (!NEWSLETTERS.includes(msg.key.remoteJid)) return;
            const emoji = _newsletterEmojis[Math.floor(Math.random() * _newsletterEmojis.length)];
            await sock.newsletterReactMessage(msg.key.remoteJid, msg.key.server_id.toString(), emoji);
        } catch {}
    }))

    // ── Background Cleanup Intervals (per bot) ─────────────────────────────────

    // Auth key files are live Signal state. Never delete them by age.
    // Only remove completed migration quarantines after the configured retention.
    bot._activeIntervals.push(setInterval(() => {
        runInBot(bot.id, () => cleanupExpiredSessionQuarantines(bot, 'scheduled cleanup'))
    }, 6 * 60 * 60 * 1000))

    // Junk file cleanup (every 10 minutes)
    bot._activeIntervals.push(setInterval(() => cleanupJunkFiles(sock), 10 * 60 * 1000))

    // Per-bot message dedupe set (cleared every 5 minutes)
    bot._activeIntervals.push(setInterval(() => bot.processedMessages.clear(), 5 * 60 * 1000))

    return sock
}

// ─── Bonus: sessionId + phone — automatic pairing fallback ───────────────────
// When a session is configured with BOTH a sessionId and a phone number, the
// sessionId is tried first (legacy bootstrap flow). If it is invalid, was
// revoked by WhatsApp, or the session gets logged out, the bot automatically
// falls back to pairing-code login with the configured phone instead of
// parking the session as needs-login.

async function fallbackToPairing(bot, reason, { newCycle = false } = {}) {
    log(`[ SESSION:${bot.id} ] ${reason} — falling back to pairing-code login.`, 'yellow')
    if (sessionExists(bot)) {
        try { quarantineCurrentSessionForReplacement(bot) } catch (_) {}
    }
    bot.sessionId = ''
    bot._fallbackToPairing = true
    bot._bootstrapRetries = 0

    // Internal reconnects preserve the unresolved cycle. Only a genuine
    // post-connection logout (or another explicit caller) starts a new one.
    if (newCycle) {
        bot.startPairingCycle('connected-session-logout')
    }
    // Otherwise this is an internal reconnect and the caller's existing cycle
    // is preserved exactly; fallback never silently creates/resets one.
    bot.botState = 'connecting'
    return bootBot(bot)
}

// ─── Per-session boot flow ────────────────────────────────────────────────────

async function bootBot(bot) {
    return runInBot(bot.id, async () => {
        await bot.db.ready

        // 1. Validate the session's sessionId format before doing anything
        const formatOk = await checkAndHandleSessionFormat(bot)
        if (!formatOk) return null

        // 2. Restore the persisted retry counter from SQLite KV.
        bot.errorRetryCount = bot.db.getSessionErrorState().count
        log(`Initial 408 retry count (${bot.id}): ${bot.errorRetryCount}`, 'yellow')

        cleanupExpiredSessionQuarantines(bot, 'startup')

        // 3. sessionId is a provisioning/recovery source — never an unconditional
        // override for a verified SQLite auth state. Store only an opaque SHA-256
        // fingerprint so we can detect a genuinely changed sessionId safely.
        const envSessionID = String(bot.sessionId || '').trim()
        const hasValidEnvSessionID = Boolean(
            envSessionID && VALID_PREFIXES.some((prefix) => envSessionID.startsWith(prefix))
        )
        const sqliteAuthReady = hasVerifiedSQLiteAuth(bot.db._db)
        const currentSessionFingerprint = hasValidEnvSessionID
            ? fingerprintSessionId(envSessionID)
            : null
        // SQLite session_auth_meta is the sole persistent home for opaque SHA-256
        // sessionId fingerprints. The raw sessionId remains registry-only.
        const storedSessionFingerprints = [
            getSessionIdFingerprint(bot.db._db),
        ].filter(Boolean)
        const revokedSessionFingerprints = [
            getSessionIdRevokedFingerprint(bot.db._db),
        ].filter(Boolean)
        const sameSessionId = Boolean(
            currentSessionFingerprint && storedSessionFingerprints.includes(currentSessionFingerprint)
        )
        const sessionIdChanged = Boolean(
            currentSessionFingerprint &&
            storedSessionFingerprints.length > 0 &&
            !sameSessionId
        )
        const sessionIdRevoked = Boolean(
            currentSessionFingerprint && revokedSessionFingerprints.includes(currentSessionFingerprint)
        )
        const usableFileSession = hasUsableFileSession(bot)

        //log(`[ sessionId:${bot.id} ] ${hasValidEnvSessionID ? 'Configured (redacted)' : '(none)'}`, 'cyan')

        if (sessionIdRevoked) {
            if (bot.phone) {
                log(`[ sessionId:${bot.id} ] This sessionId was logged out by WhatsApp.`, 'red', true)
                return fallbackToPairing(bot, 'Session ID was revoked by WhatsApp')
            }
            log(`[ sessionId:${bot.id} ] This sessionId was logged out by WhatsApp. Add a fresh sessionId to the JUNE_SESSIONS registry (.env), then restart.`, 'red', true)
            bot.botState = 'needs-login'
            return null
        }

        // A fingerprint mismatch is a warning, not permission to destroy a usable
        // file session. Auto-exported creds can legitimately change the raw backup
        // sessionId over time. Preserve usable auth and refresh the SQLite metadata;
        // an owner can use JUNE_FORCE_SESSION_BOOTSTRAP=true for an intentional
        // replacement.
        const forceSessionBootstrap = /^(1|true|yes|on)$/i.test(
            String(process.env.JUNE_FORCE_SESSION_BOOTSTRAP || '')
        )
        const shouldBootstrapFromSessionId = hasValidEnvSessionID && (
            forceSessionBootstrap ||
            (!sqliteAuthReady && !usableFileSession)
        )

        if (shouldBootstrapFromSessionId) {
            const replacingFileSession =
                (forceSessionBootstrap && sessionExists(bot)) ||
                (!usableFileSession && sessionExists(bot))

            if (replacingFileSession) {
                const reason = forceSessionBootstrap
                    ? 'a forced sessionId bootstrap'
                    : 'an unusable existing file session'
                log(`[ sessionId:${bot.id} ] Applying ${reason} — preserving prior file auth first.`, 'yellow')
                const oldSessionPath = quarantineCurrentSessionForReplacement(bot)
                if (oldSessionPath) {
                    log(`[ SESSION:${bot.id} ] Previous file auth preserved at ${path.basename(oldSessionPath)}.`, 'yellow')
                }
            } else {
                log(`[ sessionId MODE:${bot.id} ] No usable local auth found — bootstrapping from sessionId.`, 'white')
            }

            if (!sessionExists(bot)) {
                log(`[ sessionId:${bot.id} ] Writing creds.json from sessionId...`, 'magenta')
                await fs.promises.mkdir(bot.sessionDir, { recursive: true })
                try {
                    await downloadSessionData(bot)
                    if (!hasUsableFileSession(bot)) {
                        throw new Error('creds.json was not written or is invalid after sessionId bootstrap')
                    }
                    log(`[ sessionId:${bot.id} ] ✅ Session bootstrap saved successfully.`, 'green')
                } catch (e) {
                    bot._bootstrapRetries = (bot._bootstrapRetries || 0) + 1
                    const multiSession = sessionManager.list().length > 1
                    // Legacy single-session keeps the original retry-forever
                    // behaviour. In multi-session mode a broken session id
                    // must not spam logs forever — park the session instead,
                    // or fall back to pairing when a phone is configured.
                    if (!bot.interactive && (multiSession || bot._bootstrapRetries >= 3)) {
                        if (bot.phone) {
                            log(`[ sessionId:${bot.id} ] ❌ Bootstrap failed (${e.message}).`, 'red', true)
                            markSessionIdFingerprintRevoked(bot, fingerprintSessionId(envSessionID))
                            return fallbackToPairing(bot, 'Session ID bootstrap failed')
                        }
                        log(`[ sessionId:${bot.id} ] ❌ Failed to bootstrap session: ${e.message}`, 'red', true)
                        log(`[ SESSION:${bot.id} ] Marked as needs-login — fix its sessionId in sessions.json / JUNE_SESSIONS, then restart.`, 'yellow')
                        bot.botState = 'needs-login'
                        return null
                    }
                    log(`[ sessionId:${bot.id} ] ❌ Failed to bootstrap session: ${e.message}`, 'red', true)
                    log('Retrying in 5 seconds...', 'yellow')
                    await delay(5000)
                    return bootBot(bot)
                }
            }

            invalidateSQLiteAuth(
                bot.db._db,
                forceSessionBootstrap ? 'session-id-forced-bootstrap' : 'session-id-bootstrap'
            )
            rememberSessionIdFingerprint(bot, currentSessionFingerprint)
            clearRevokedSessionIdFingerprint(bot)
            await bot.db.setStoredLoginMethod('session')
            log(`[ sessionId:${bot.id} ] Connecting...`, 'cyan')
            return startBotSocket(bot)
        }

        if (hasValidEnvSessionID && sqliteAuthReady) {
            if (revokedSessionFingerprints.length > 0 && !sessionIdRevoked) {
                clearRevokedSessionIdFingerprint(bot)
            }
            if (!sameSessionId) {
                // Upgrade path for an existing verified June X installation.
                rememberSessionIdFingerprint(bot, currentSessionFingerprint)
                log(`[ AUTH:${bot.id} ] Linked the existing verified SQLite auth to the configured sessionId fingerprint.`, 'cyan')
            }
           // log(`[ AUTH:${bot.id} ] Verified SQLite auth found; sessionId is retained only as a recovery backup.`, 'green')
        } else if (hasValidEnvSessionID && usableFileSession) {
            // The file session is usable. If fingerprint metadata is absent (for
            // example after the move from marker files to session_auth_meta), adopt
            // this session instead of quarantining and recreating it.
            if (!sameSessionId && currentSessionFingerprint) {
                if (sessionIdChanged) {
                    log(`[ sessionId:${bot.id} ] Configured fingerprint differs; retaining usable file auth. Set JUNE_FORCE_SESSION_BOOTSTRAP=true only for an intentional replacement.`, 'yellow')
                }
                const saved = rememberSessionIdFingerprint(bot, currentSessionFingerprint)
                if (saved) {
                    log(`[ sessionId:${bot.id} ] Existing file auth adopted; fingerprint recorded in SQLite.`, 'green')
                }
            }
            if (revokedSessionFingerprints.length > 0 && !sessionIdRevoked) {
                clearRevokedSessionIdFingerprint(bot)
            }
            await bot.db.setStoredLoginMethod('session')
            log(`[ sessionId:${bot.id} ] Existing usable file session retained; rebuilding SQLite auth if needed.`, 'cyan')
        } else {
            log(`[ALERT:${bot.id}] No sessionId configured for this session.`, 'blue')
        }

        // 4. Integrity check on stored session
        await checkSessionIntegrityAndClean(bot)

        // 5. Use existing stored session if valid
        if (sessionExists(bot)) {
            log(`[ALERT:${bot.id}] Valid stored session found.`, 'green')
            return startBotSocket(bot)
        }

        // 5b. A verified SQLite auth state is complete on its own. Do not
        // reconstruct only creds.json from the legacy session table.
        if (hasVerifiedSQLiteAuth(bot.db._db)) {
            log(`[ AUTH:${bot.id} ] Verified SQLite auth found; starting without session files.`, 'green')
            await bot.db.setStoredLoginMethod('session')
            return startBotSocket(bot)
        }

        // 5c. Legacy fallback for databases created before complete auth storage.
        const restoredFromDB = await restoreSessionFromDB(bot)
        if (restoredFromDB) {
            await bot.db.setStoredLoginMethod('session')
            return startBotSocket(bot)
        }

        // 6. No sessionId and no stored session — login menu (interactive) or
        //    pairing / needs-login for headless and registry sessions.
        const isSoloLegacySession = sessionManager.list().length === 1 && bot.id === DEFAULT_BOT_ID
        if (!process.stdin.isTTY && isSoloLegacySession && !bot.sessionId && !bot.phone) {
            log('❌ No sessionId/phone configured and no TTY available for interactive login.', 'red')
            process.exit(1)
        }

        // 6b. Pairing budget exhausted: park until an explicit re-trigger
        //     (.restart on this session, a process restart, or the interactive
        //     login menu which counts as an explicit re-trigger).
        if (bot.pairingExhausted) {
            log(`[ SESSION:${bot.id} ] Pairing exhausted — parked as needs-login. Send .restart to this session or restart the process for a fresh cycle.`, 'yellow')
            bot.botState = 'needs-login'
            return null
        }

        log(chalk.black.bgYellowBright(`[ LOGIN:${bot.id} ] No sessionId found and no stored session.`), 'white')
        const loginMethod = await getLoginMethod(bot)
        if (!loginMethod) return null // needs-login; session stays registered
        if (loginMethod === 'number' && !bot.hasActivePairingCycle()) {
            // Phone selection is part of this process-start login operation.
            bot.startPairingCycle('process-start')
        }
        if (loginMethod === 'session') {
            try {
                await downloadSessionData(bot)
                if (!sessionExists(bot)) {
                    throw new Error('Session file was not written — the sessionId may be corrupt or expired.')
                }
                log(`[ LOGIN:${bot.id} ] ✅ Session ID accepted. Connecting...`, 'green')
            } catch (e) {
                log(`[ LOGIN:${bot.id} ] ❌ Failed to load session: ${e.message}`, 'red', true)
                log('Please check the sessionId and try again. Retrying in 5 seconds...', 'yellow')
                await delay(5000)
                return bootBot(bot)
            }
        }
        return startBotSocket(bot)
    })
}

// ─── Wire one session's database, config and remote adapters ─────────────────

async function wireBotRuntime(bot) {
    return runInBot(bot.id, async () => {
        // Per-bot SQLite database (june-<botId>.db — the default bot keeps the
        // legacy database file so existing installs keep their data).
        bot.db = juneDatabase.registerBotDatabase(bot.id)
        await bot.db.ready

        // Per-bot remote mirror adapters.
        bot.pg = pgAdapter.forBot(bot.id)
        bot.mongo = mongoAdapter.forBot(bot.id)

        // Per-bot config object (independent clone of the base config).
        bot.config = config.__createBotConfig({
            prefix: config.__getBaseConfig().prefix,
            botName: config.__getBaseConfig().botName,
        })
        // Only an EXPLICIT registry name changes the bot's botName; the
        // auto-derived display name ("June X 640") leaves config untouched.
        if (bot.nameExplicit) bot.config.botName = bot.name
        config.__registerBotConfig(bot.id, bot.config)

        const [pgStatus, mongoStatus] = await Promise.all([
            bot.pg.init(),
            bot.mongo.init(),
        ])
        if (pgStatus.available) {
            const restored = await bot.db.restoreFromPostgres()
            if (restored.restored > 0) {
                log(`[ PG:${bot.id} ] Restored ${restored.restored} missing local database records.`, 'green')
            }
        }
        if (mongoStatus.available) {
            const restored = await bot.db.restoreFromMongo()
            if (restored.restored > 0) {
                log(`[ MONGO:${bot.id} ] Restored ${restored.restored} missing local database records.`, 'green')
            }
        }

        // Disaster recovery path: if this host lost its local auth database and
        // has no usable file session, restore the direct remote auth state before
        // normal sessionId/session startup decisions run.
        if (!hasVerifiedSQLiteAuth(bot.db._db) && !hasUsableFileSession(bot)) {
            const authRecovery = await bot.db.restoreRemoteAuthState()
            if (authRecovery.restored) {
                log(`[ AUTH MIRROR:${bot.id} ] Restored ${authRecovery.source} auth state (${authRecovery.keyRows} key rows).`, 'green')
            } else if (authRecovery.error) {
                log(`[ AUTH MIRROR:${bot.id} ] Remote auth state was unavailable or invalid.`, 'yellow')
            }
        }
        if (hasVerifiedSQLiteAuth(bot.db._db)) {
            // Ensure an already healthy deployment mirrors the current auth state
            // without waiting for the next creds.update event.
            if (bot.db.scheduleRemoteAuthMirror('startup')) {
                log(`[ AUTH MIRROR:${bot.id} ] External auth state mirror scheduled.`, 'cyan')
            }
        }

        await applyPersistedRuntimeSettings(bot)
    })
}

// ─── Apply Persisted Runtime Settings (per bot) ───────────────────────────────

async function applyPersistedRuntimeSettings(bot) {
    try {
        const db = bot.db
        const all = db.getAllBotSettings()
        // Apply ALL stored settings that directly match a config key.
        for (const [key, value] of Object.entries(all)) {
            if (key in bot.config && value !== null && value !== undefined) {
                bot.config[key] = value;
            }
        }
        // Restore presence flags so .botstatus/.getsettings reflect the correct state
        try {
          const _m = require('./utils/presenceSettings').getModes();
          bot.config.autoTyping = _m.pm === 'typing' || _m.group === 'typing';
          bot.config.autoRecording = _m.pm === 'recording' || _m.group === 'recording' || _m.pm === 'recordtype' || _m.group === 'recordtype';
          bot.config.autoRecordType = _m.pm === 'recordtype' || _m.group === 'recordtype';
        } catch (_) {}

        // Custom menu images stay in SQLite and are decoded directly by
        // commands/general/menu.js when a menu is sent. Do not rebuild or
        // maintain a persistent runtime image copy here.
    } catch (e) {
        log(`[ SETTINGS:${bot.id} ] Could not load runtime settings: ${e.message}`, 'yellow');
    }
}

// ─── Keep-Alive HTTP Server (multi-session dashboard) ─────────────────────────

function startKeepAliveServer() {
    const express   = require('express');
    const http      = require('http');
    const app       = express();
    const START_TIME = Date.now();

    const renderSessionRow = (state) => {
        const statusLabel = state.connected
            ? 'CONNECTED'
            : (state.state === 'connecting' ? 'CONNECTING' : (state.state === 'needs-login' ? 'NEEDS LOGIN' : 'OFFLINE'));
        const statusColor = state.connected ? '#00ffe0' : (state.state === 'connecting' ? '#ffb703' : '#e94560');
        let sub;
        if (state.connected) {
            sub = (state.account || '') + ' • connected ' + new Date(state.connectedAt).toLocaleTimeString();
        } else if (state.pairingExhausted) {
            sub = 'pairing limit reached — .restart to retry';
        } else if (state.pairingAttempts > 0) {
            sub = `pairing codes issued: ${state.pairingAttempts}`;
        } else {
            sub = state.error ? 'last error: ' + String(state.error).slice(0, 90) : 'awaiting connection';
        }
        return `<div class="card">
      <div class="card-title">🤖 ${String(state.name).replace(/[<>&]/g, '')} <span style="color:${statusColor}">(${String(state.id).replace(/[<>&]/g, '')})</span></div>
      <div class="card-value small" style="color:${statusColor}">${statusLabel}</div>
      <div class="card-sub">${sub}</div>
    </div>`;
    };

    // Read-only status dashboard — server-rendered, no client JS/fetch, no
    // pairing/session-ID UI or endpoints. Auto-refreshes via <meta refresh>
    // so it renders identically on every platform/browser.
    app.get('/', (req, res) => {
        const uptimeMs = Date.now() - START_TIME;
        const totalSeconds = Math.floor(uptimeMs / 1000);
        const days = Math.floor(totalSeconds / 86400);
        const hours = Math.floor((totalSeconds % 86400) / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        const uptimeStr = days > 0
            ? `${days}d ${hours}h ${minutes}m ${seconds}s`
            : `${hours.toString().padStart(2, '0')}h ${minutes.toString().padStart(2, '0')}m ${seconds.toString().padStart(2, '0')}s`;

        const now = new Date();
        const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        const platform = detectPlatform();
        const sessions = sessionManager.snapshot();
        const connectedCount = sessions.filter((s) => s.connected).length;
        const statusColor = connectedCount > 0 ? '#00ffe0' : (sessions.some((s) => s.state === 'connecting') ? '#ffb703' : '#e94560');

        res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="10">
  <title>June-X Ultra — Multi-Session Dashboard</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&family=JetBrains+Mono:wght@400;600&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: radial-gradient(circle at 20% 30%, #0a0f1e, #03060c);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      color: #e2f0ff;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem;
      position: relative;
      overflow-x: hidden;
    }
    body::before {
      content: '';
      position: fixed;
      top: 0; left: 0;
      width: 100%; height: 100%;
      background-image: radial-gradient(2px 2px at 20px 30px, #00ffe0, rgba(0,0,0,0)), radial-gradient(1px 1px at 80px 140px, #ff6b35, rgba(0,0,0,0)), radial-gradient(3px 3px at 260px 80px, #00aaff, rgba(0,0,0,0));
      background-size: 200px 200px, 180px 180px, 220px 220px;
      background-repeat: no-repeat;
      opacity: 0.3;
      pointer-events: none;
      animation: drift 60s linear infinite;
    }
    @keyframes drift {
      0% { background-position: 0 0, 0 0, 0 0; }
      100% { background-position: 400px 400px, 300px 300px, 500px 500px; }
    }
    .wrapper { max-width: 560px; width: 100%; z-index: 2; position: relative; }
    .header { text-align: center; margin-bottom: 2.5rem; }
    .bot-name {
      font-family: 'JetBrains Mono', 'SF Mono', 'Cascadia Code', 'Consolas', 'Courier New', monospace;
      font-size: 2.5rem;
      font-weight: 700;
      background: linear-gradient(135deg, #00ffe0, #ff6b35);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
      text-shadow: 0 0 20px rgba(0,255,224,0.3);
      letter-spacing: -0.02em;
      display: inline-block;
      animation: glitch 3s infinite;
    }
    @keyframes glitch {
      0%, 100% { transform: skew(0deg, 0deg); opacity: 1; }
      95% { transform: skew(0deg, 0deg); opacity: 1; }
      96% { transform: skew(2deg, 1deg); opacity: 0.8; text-shadow: -2px 0 #ff6b35, 2px 0 #00ffe0; }
      97% { transform: skew(-1deg, -0.5deg); opacity: 0.9; }
    }
    .tagline { font-size: 0.8rem; letter-spacing: 4px; text-transform: uppercase; color: #7f9eb5; margin-top: 0.5rem; }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      background: rgba(0,255,224,0.1);
      border-radius: 60px;
      padding: 0.4rem 1.5rem;
      margin-top: 1.2rem;
      font-size: 0.75rem;
      font-weight: 500;
      letter-spacing: 1px;
      backdrop-filter: blur(4px);
    }
    .dot {
      width: 10px; height: 10px;
      background: ${statusColor};
      border-radius: 50%;
      box-shadow: 0 0 8px ${statusColor};
      animation: pulse 1.4s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.8); }
    }
    .dashboard-grid { display: flex; flex-direction: column; align-items: center; gap: 1.5rem; margin-bottom: 2rem; }
    .card {
      width: 100%; max-width: 460px;
      background: rgba(10, 20, 28, 0.65);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(0, 255, 224, 0.2);
      border-radius: 0;
      padding: 1.5rem;
      transition: transform 0.2s ease, border-color 0.2s;
      box-shadow: 0 0 15px rgba(0, 255, 224, 0.2), 0 8px 20px rgba(0,0,0,0.2);
      text-align: center;
      position: relative;
      overflow: hidden;
    }
    .card::before, .card::after {
      content: '';
      position: absolute;
      width: 50px; height: 50px;
      pointer-events: none;
      transition: 0.3s;
    }
    .card::before { top: 0; left: 0; border-top: 2px solid #00ffe0; border-left: 2px solid #00ffe0; border-radius: 0 0 20px 0; box-shadow: -2px -2px 12px rgba(0,255,224,0.5); }
    .card::after  { bottom: 0; right: 0; border-bottom: 2px solid #ff6b35; border-right: 2px solid #ff6b35; border-radius: 20px 0 0 0; box-shadow: 2px 2px 12px rgba(255,107,53,0.5); }
    .card:hover::before { border-top-color: #ff6b35; border-left-color: #ff6b35; box-shadow: -2px -2px 18px #ff6b35; }
    .card:hover::after  { border-bottom-color: #00ffe0; border-right-color: #00ffe0; box-shadow: 2px 2px 18px #00ffe0; }
    .card:hover { transform: translateY(-4px); border-color: rgba(0, 255, 224, 0.6); box-shadow: 0 0 25px rgba(0,255,224,0.3), 0 15px 30px rgba(0,0,0,0.3); }
    .card-title { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 2px; color: #6c8ea0; margin-bottom: 0.75rem; display: flex; align-items: center; justify-content: center; gap: 0.5rem; }
    .card-value { font-family: 'JetBrains Mono', 'SF Mono', 'Cascadia Code', 'Consolas', 'Courier New', monospace; font-size: 1.6rem; font-weight: 600; color: #00ffe0; text-shadow: 0 0 6px rgba(0,255,224,0.3); line-height: 1.2; word-break: break-word; }
    .card-value.small { font-size: 1.2rem; }
    .card-sub { font-size: 0.65rem; color: #8aaec0; margin-top: 0.6rem; border-top: 1px dashed rgba(0,255,224,0.2); padding-top: 0.6rem; }
    .footer { text-align: center; margin-top: 2rem; font-size: 0.7rem; color: #5a7c8c; letter-spacing: 1px; text-transform: uppercase; }
    .footer strong { color: #00ffe0; }
    .refresh-note { text-align: center; font-size: 0.65rem; margin-top: 1rem; opacity: 0.6; }
    @media (max-width: 480px) {
      body { padding: 1rem; }
      .bot-name { font-size: 1.8rem; }
      .card-value { font-size: 1.3rem; }
      .card-value.small { font-size: 1rem; }
      .card { max-width: 100%; }
    }
  </style>
</head>
<body>
<div class="wrapper">
  <div class="header">
    <div class="bot-name">June-X Ultra</div>
    <div class="tagline">Autonomous Bot Matrix • Multi-Session</div>
    <div class="status-badge">
      <span class="dot"></span> ${connectedCount}/${sessions.length} sessions online
    </div>
  </div>
  <div class="dashboard-grid">
    <div class="card">
      <div class="card-title">🖥️ PLATFORM</div>
      <div class="card-value small">${platform}</div>
      <div class="card-sub">deployment environment</div>
    </div>
    <div class="card">
      <div class="card-title">⏱ UPTIME</div>
      <div class="card-value">${uptimeStr}</div>
      <div class="card-sub">continuous runtime</div>
    </div>
    <div class="card">
      <div class="card-title">📅 DATE</div>
      <div class="card-value small">${dateStr}</div>
      <div class="card-sub">local server date</div>
    </div>
    ${sessions.map(renderSessionRow).join('\n    ') || '<div class="card"><div class="card-title">NO SESSIONS</div><div class="card-value small">offline</div><div class="card-sub">add sessions via JUNE_SESSIONS or sessions.json</div></div>'}
  </div>
  <div class="footer">
    ⚡ Powered by <strong>supreme</strong> &nbsp;|&nbsp; June-X Ultra
  </div>
  <div class="refresh-note">⟳ dashboard auto-refreshes every 10 seconds</div>
</div>
</body>
</html>`);
    });

    app.get('/health', (req, res) => res.status(200).send('OK'));

    app.get('/health/details', async (req, res) => {
        try {
            const defaultBot = sessionManager.defaultBot() || sessionManager.list()[0];
            if (!defaultBot) return res.status(503).json({ ok: false, error: 'no sessions registered' });
            const databaseHealth = defaultBot.db.getDatabaseHealth();
            const authStats = getSQLiteAuthStats(defaultBot.db._db);
            let antiDelete = null;
            try {
                antiDelete = require('./commands/owner/antidelete').getStoreStats();
            } catch (_) {}
            res.json({
                ok: databaseHealth.ok === true &&
                    (!databaseHealth.backupExists || databaseHealth.backupValid === true),
                sessions: sessionManager.snapshot(),
                database: {
                    sizeBytes: databaseHealth.databaseSizeBytes,
                    backupSizeBytes: databaseHealth.backupSizeBytes,
                    backupExists: databaseHealth.backupExists,
                    backupValid: databaseHealth.backupValid,
                    dirty: databaseHealth.dirty,
                    lastBackup: databaseHealth.lastBackup,
                    integrity: databaseHealth.lastIntegrityCheck,
                    maintenance: databaseHealth.maintenance,
                    remoteSync: databaseHealth.remoteSync,
                    authMirror: databaseHealth.authMirror,
                    postgres: databaseHealth.postgres,
                    mongo: databaseHealth.mongo,
                },
                stability: {
                    replayDrain: replayDrain.getStats(),
                },
                auth: {
                    verified: authStats.verified,
                    hasCreds: authStats.hasCreds,
                    totalKeys: authStats.totalKeys,
                    byType: authStats.byType,
                    pendingFileMigration: authStats.pendingFileMigration,
                    invalidReason: authStats.invalidReason,
                },
                antiDelete,
                storage: diskManager?.getReport?.() || null,
                telemetry: {
                    stats: (() => {
                        const rows = defaultBot.db.getRuntimeTelemetry(1000);
                        return {
                            total: rows.length,
                            eventTypes: rows.reduce((counts, row) => {
                                counts[row.eventType] = (counts[row.eventType] || 0) + row.count;
                                return counts;
                            }, {}),
                        };
                    })(),
                },
            });
        } catch (error) {
            res.status(503).json({ ok: false, error: error.message });
        }
    });

    const server = http.createServer(app);

    const PORTS_TO_TRY = process.env.PORT
        ? [parseInt(process.env.PORT, 10)]
        : [5000, 3000, 8000, 4000];

    let portIndex = 0;

    function tryListen() {
        if (portIndex >= PORTS_TO_TRY.length) return;
        const PORT = PORTS_TO_TRY[portIndex];
        server.listen(PORT, '0.0.0.0');

        server.once('listening', () => {
            const selfPingUrl = process.env.APP_URL || `http://localhost:${PORT}/health`;
            setInterval(() => {
                http.get(selfPingUrl, (r) => {}).on('error', () => {});
            }, 4 * 60 * 1000);
        });

        server.once('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                portIndex++;
                tryListen();
            }
        });
    }

    tryListen();
    return server;
}

let keepAliveServer = null

// ─── Per-session restart ──────────────────────────────────────────────────────
// Restarts ONLY the session that asked for it: the other sessions keep
// running untouched. The command layer reaches this through
// global.__JUNE_RESTART_SESSION(botId), falling back to process.exit(1) only
// when the hook is unavailable (legacy single-session deployments).

async function restartBot(id, { pairingReason = 'explicit-restart' } = {}) {
    const bot = sessionManager.get(id)
    if (!bot) {
        log(`[ SESSION ] Restart requested for unknown session: ${id}`, 'red', true)
        return { ok: false, id: String(id), error: 'unknown session' }
    }
    return runInBot(bot.id, async () => {
        try {
            log(`[ SESSION:${bot.id} ] Manual restart requested — rebooting this session only.`, 'yellow')
            bot._shutdownRequested = false // reconnect machinery must stay active
            bot.isReconnecting = false
            bot.isBotConnected = false
            bot.botState = 'connecting'
            // Explicit re-trigger: a parked/exhausted session gets a fresh
            // pairing cycle when the configured phone exists.
            if (bot.phone) bot.startPairingCycle(pairingReason)
            else bot.terminatePairingCycle(pairingReason)

            // Tear down only this bot's socket. removeAllListeners prevents
            // the old socket's close event from re-entering the reconnect
            // state machine while the fresh socket is booting.
            const oldSock = bot.sock
            bot.sock = null
            if (oldSock) {
                try { oldSock.ev?.removeAllListeners?.() } catch (_) {}
                try { oldSock.ws?.close?.() } catch (_) {}
                try { oldSock.end?.(new Error('manual session restart')) } catch (_) {}
                await delay(250)
            }

            const sock = await startBotSocket(bot)
            // Wait (bounded) for the fresh socket to finish connecting so
            // callers can reply through a live connection.
            if (!sock.user) {
                await new Promise((resolve) => {
                    const onOpen = (update) => {
                        if (update.connection === 'open') {
                            try { sock.ev?.off?.('connection.update', onOpen) } catch (_) {}
                            resolve()
                        }
                    }
                    sock.ev?.on?.('connection.update', onOpen)
                    setTimeout(() => {
                        try { sock.ev?.off?.('connection.update', onOpen) } catch (_) {}
                        resolve()
                    }, 30000).unref?.()
                })
            }
            log(`[ SESSION:${bot.id} ] Restart complete.`, 'green')
            return { ok: true, id: bot.id, sock }
        } catch (error) {
            log(`[ SESSION:${bot.id} ] Restart failed: ${error?.message || error}`, 'red', true)
            bot.lastError = String(error?.message || error)
            bot.botState = 'needs-login'
            return { ok: false, id: bot.id, error: String(error?.message || error) }
        }
    })
}

global.__JUNE_RESTART_SESSION = restartBot

global.__JUNE_SHUTDOWN = async () => {
    if (global._shutdownPromise) return global._shutdownPromise
    global._shutdownRequested = true
    global._shutdownPromise = (async () => {
        log('[ SHUTDOWN ] Gracefully stopping June-X...', 'yellow')
        try { global._envWatcher?.close?.() } catch (_) {}
        await sessionManager.stopAll()
        // Anti-delete and group stats keep small in-memory debounce queues.
        // Persist both before the databases close — one pass per bot context
        // so each bot's pending rows land in its own database.
        for (const botId of juneDatabase.listBotIds()) {
            await runInBot(botId, () => {
                try { global.__JUNE_FLUSH_ANTIDELETE?.() } catch (_) {}
                try { global.__JUNE_FLUSH_GROUP_STATS?.() } catch (_) {}
            })
        }
        try { diskManager?.stop?.() } catch (_) {}
        try { keepAliveServer?.close?.() } catch (_) {}
        for (const bot of sessionManager.list()) {
            try { await autoExportSessionToRegistry(bot, true) } catch (_) {}
        }
        try { await juneDatabase.shutdownAllDatabases() } catch (error) {
            log(`[ SHUTDOWN ] Database flush failed: ${error.message}`, 'red', true)
        }
        log('[ SHUTDOWN ] Complete.', 'green')
    })()
    return global._shutdownPromise
}

// ─── Graceful signal handling (VPS reboots, Ctrl+C, panel restarts) ──────────
// A machine reboot sends SIGTERM/SIGINT straight to the process. Route it
// through the full graceful shutdown so every session's queues, mirrors and
// databases are flushed first — then exit. A bounded grace period guarantees
// the process never hangs the reboot.
for (const _sig of ['SIGINT', 'SIGTERM']) {
    process.on(_sig, () => {
        log(`[ SIGNAL ] Received ${_sig} — flushing all sessions before exit.`, 'yellow')
        Promise.race([
            Promise.resolve(global.__JUNE_SHUTDOWN()),
            new Promise((resolve) => setTimeout(resolve, 10000)),
        ])
            .catch(() => {})
            .finally(() => process.exit(0))
    })
}

// ─── Main Login Flow ──────────────────────────────────────────────────────────

async function main() {
    // The database uses async sql.js initialization when better-sqlite3 cannot
    // load on an older VPS. Nothing may read settings/auth/schema before this.
    await juneDatabase.ready

    // The .env file's JUNE_SESSIONS line is authoritative at boot too: sync it
    // into process.env before the registry is read (dotenv may have loaded an
    // older value, and platform env vars are only used when the file has no
    // JUNE_SESSIONS line at all).
    if (syncJuneSessionsFromEnvFile()) {
        log('[ MULTI-SESSION ] Applied JUNE_SESSIONS from .env.', 'cyan')
    }

    const entries = loadSessionRegistry()
    const ids = entries.map((entry) => String(entry.id || DEFAULT_BOT_ID))
    const unique = [...new Set(ids)]
    if (entries.length !== unique.length) {
        log('[ MULTI-SESSION ] Duplicate session ids detected — later entries override earlier ones.', 'yellow')
    }
    log(`[ MULTI-SESSION ] ${unique.length} session(s) registered`, 'cyan')
    if (unique.length > 1) {
        //log('[ MULTI-SESSION ] Multi-session mode: each session uses its own SQLite database (june-<id>.db) and auth directory.', 'cyan')
    }

    // Wire every session: database, config, remote adapters, recovery.
    // Sessions present at initial startup are the ONLY candidates allowed to
    // establish the deployment Super Owner (first successful connection).
    for (const entry of entries) {
        const bot = sessionManager.register(entry)
        bot.isInitialSession = true
        // A full process start intentionally creates a fresh generation. It may
        // be terminated unused if verified auth connects without pairing.
        if (bot.phone) bot.startPairingCycle('process-start')
        try {
            await wireBotRuntime(bot)
        } catch (error) {
            log(`[ SESSION:${bot.id} ] Runtime wiring failed: ${error?.message || error}`, 'red', true)
            bot.lastError = String(error?.message || error)
            bot.botState = 'needs-login'
        }
    }

    // The startup report is a SINGLE-SESSION presentation feature. When the
    // process starts with 2+ sessions, no per-session report boxes are
    // printed — only the normal session logs (see reconcileSessions for the
    // runtime hot-add equivalent). Marking the flags before boot guarantees
    // the report cannot appear later, even if sessions are removed down to
    // one afterwards.
    if (sessionManager.list().length > 1) {
        for (const bot of sessionManager.list()) bot.startupReportPrinted = true
    }

    if (!handler) handler = require('./handler')
    diskManager.start()

    checkEnvStatus()

    // Boot every session concurrently — each session is independent and
    // reconnects on its own; a failed session never blocks the others.
    const bootPromises = sessionManager.list().map((bot) => (async () => {
        try {
            await bootBot(bot)
        } catch (error) {
            log(`[ SESSION:${bot.id} ] Boot failed: ${error?.message || error}`, 'red', true)
            bot.lastError = String(error?.message || error)
            bot.botState = 'needs-login'
        }
    })())

    // The dashboard serves immediately — sessions connect in the background.
    keepAliveServer = startKeepAliveServer();

    await Promise.allSettled(bootPromises)

    // Live registry reconciliation: seed the managed-id set, then poll so
    // sessions can be hot-added / hot-removed without a restart. Each tick
    // re-reads the .env JUNE_SESSIONS line first, so panels without a
    // reliable fs.watch still hot-apply edits within one poll interval.
    try { await reconcileSessions() } catch (_) {}
    setInterval(() => {
        if (syncJuneSessionsFromEnvFile()) {
            log('[ MULTI-SESSION ] JUNE_SESSIONS changed in .env — applying live (hot-add/hot-remove).', 'green')
            scheduleSessionReconcile()
        }
    }, SESSIONS_POLL_MS).unref?.()
}

// ─── Boot ──────────────────────────────────────────────────────────────────────

main().catch(err => log(`Fatal error: ${err.message}`, 'red', true))

process.on('uncaughtException', (err) => {
    if (err.code === 'ENOSPC' || err.errno === -28) {
        log('⚠️ ENOSPC: No space left on device. Attempting cleanup...', 'yellow')
        cleanupJunkFiles(null)
        return
    }
    log(`Uncaught Exception: ${err.message}`, 'red', true)
})

process.on('unhandledRejection', (err) => {
    if (err?.code === 'ENOSPC' || err?.errno === -28) {
        log('⚠️ ENOSPC in promise.', 'yellow')
        return
    }
    if (err?.message?.includes('rate-overlimit')) return
    if (err?.message?.includes('AUTH_STARTUP_VALIDATION_FAILED')) {
        log(`[ AUTH ] Startup recovery stopped safely: ${err.message.replace(/^AUTH_STARTUP_VALIDATION_FAILED:\s*/, '')}`, 'yellow')
        log('[ AUTH ] No auth data was cleared. Restore a known-good backup or explicitly re-pair.', 'yellow')
        return
    }
    log(`Unhandled Rejection: ${err?.message}`, 'red', true)
})

// Backward-compatible export: resolves to the current bot's message store.
module.exports = {
    store: new Proxy({}, {
        get(_target, prop) {
            const bot = sessionManager.defaultBot() || sessionManager.list()[0];
            return bot?.store?.[prop];
        },
    }),
    sessionManager,
}
