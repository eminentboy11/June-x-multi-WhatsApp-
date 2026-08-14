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
 * Sessions are defined via:
 *   JUNE_SESSIONS env  (JSON array or { "sessions": [...] })
 *   sessions.json      (same shape)
 *   legacy SESSION_ID  (single session, id = JUNE_BOT_ID/BOT_ID/OWNER_NUMBER)
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
const { runInBot, DEFAULT_BOT_ID } = require('./utils/botContext')
const {
    SessionManager,
    loadSessionRegistry,
    sessionLogLabel,
} = require('./utils/sessionManager')
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

function log(message, color = 'white', isError = false) {
    const prefix = chalk.blue.bold('[ JUNEX ULTRA ]')
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
// Raw SESSION_ID values remain environment-only secrets.

// ─── Auto-generate .env if missing ────────────────────────────────────────────
if (!fs.existsSync(envPath)) {
    const defaultEnv = [
        '# June Ultra — Environment Variables',
        '# Paste your session ID here after first login using .getsession',
        'SESSION_ID=',
        '',
        '# Optional: override bot port (default 5000)',
        '# PORT=5000',
        '',
        '# ── Multi-session (optional) ──────────────────────────────────',
        '# Define more sessions with JUNE_SESSIONS JSON or sessions.json:',
        '# JUNE_SESSIONS=[{"id":"second","name":"June Backup","sessionId":"JUNE-MD:~...","phone":""}]',
    ].join('\n')
    atomicWriteFile(envPath, defaultEnv, 'utf8')
    log('[ .env ] No .env file found — created with default template.', 'green')
}

// ─── Direct .env SESSION_ID reader ───────────────────────────────────────────
function readSessionIDFromEnv() {
    try {
        if (!fs.existsSync(envPath)) return ''
        const lines = fs.readFileSync(envPath, 'utf8').split('\n')
        for (const line of lines) {
            const trimmed = line.trim()
            if (trimmed.startsWith('#') || !trimmed.startsWith('SESSION_ID=')) continue
            // Everything after the first '=' is the value (preserves '=' inside base64)
            const value = trimmed.slice('SESSION_ID='.length).trim()
            return value
        }
    } catch (e) {
        log(`[ .env ] Failed to read SESSION_ID: ${e.message}`, 'red', true)
    }
    return ''
}

// Inject the directly-read value into process.env so the rest of the code
const _rawSessionID = readSessionIDFromEnv()
// A non-empty local .env value overrides the platform value. An empty local
// value intentionally leaves Heroku/Replit/Railway environment secrets intact.
if (_rawSessionID) process.env.SESSION_ID = _rawSessionID

// ─── Session manager ──────────────────────────────────────────────────────────

const sessionManager = new SessionManager()

// ─── Cleanup Functions ────────────────────────────────────────────────────────

function clearSessionFiles(bot) {
    try {
        log(`[ CLEARING:${bot.id} ] session folder...`, 'blue')
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
        log(`[ SESSION:${bot.id} ] files cleared successfully.`, 'green')
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
        log(`[ AUTH META:${bot.id} ] SESSION_ID fingerprint could not be verified in SQLite.`, 'red', true)
        return false
    }

    bot.db.markDatabaseDirty('session-id-fingerprint')
    log(`[ AUTH META:${bot.id} ] SESSION_ID fingerprint saved in SQLite.`, 'green')
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

// A new SESSION_ID deliberately replaces file auth once. The old directory is
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

const VALID_PREFIXES = ['JUNE-MD:~', 'Ultra-X:~', 'June-Ultra:~', 'June::~']

function validateSessionIdFormat(sessionId) {
    const value = String(sessionId || '').trim()
    if (!value) return true // absence is fine — handled by the login flow
    return VALID_PREFIXES.some(p => value.startsWith(p))
}

async function checkAndHandleSessionFormat(bot) {
    const sessionId = String(bot.sessionId || '').trim()
    if (sessionId && !validateSessionIdFormat(sessionId)) {
        log(chalk.black.bgYellowBright(`[ERROR:${bot.id}] Invalid SESSION_ID format.`), 'white')
        log(chalk.black.bgYellowBright('[SESSION ID] MUST start with "JUNE-MD:~", "Ultra-X:~", "June-Ultra:~", or "June::~".'), 'white')
        const isSoloLegacySession = sessionManager.list().length === 1 && bot.id === DEFAULT_BOT_ID
        if (isSoloLegacySession) {
            log(chalk.black.bgYellowBright('Please fix your SESSION_ID and restart. Exiting in 20 seconds...'), 'white')
            await delay(20000)
            process.exit(1)
        }
        log(`[ SESSION:${bot.id} ] Skipping this session; fix its sessionId in sessions.json / JUNE_SESSIONS.`, 'red', true)
        bot.botState = 'needs-login'
        bot.lastError = 'Invalid SESSION_ID format'
        return false
    }
    return true
}

// ─── Download Session from SESSION_ID ─────────────────────────────────────────

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
        log(`✅ [${bot.id}] Session saved from SESSION_ID successfully.`, 'green')
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
// A configured SESSION_ID is an input/provisioning secret, not a value that
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

// Registry sessions keep their refreshed sessionId inside sessions.json, the
// legacy default session keeps the .env SESSION_ID export behaviour.
function exportSessionToRegistry(bot, force = false) {
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

        const { SESSIONS_FILE, loadRegistryFromFile } = require('./utils/sessionManager')
        let entries = null
        try { entries = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8')) } catch (_) {}
        if (!entries) return
        const list = Array.isArray(entries) ? entries : (entries.sessions || [])
        const target = list.find((entry) => String(entry.id) === String(bot.id))
        if (!target) return

        global._suppressEnvWatcherUntil = Date.now() + 3000
        target.sessionId = sessionID
        atomicWriteFile(SESSIONS_FILE, JSON.stringify(entries, null, 2))
        bot.sessionId = sessionID
        rememberSessionIdFingerprint(bot, fingerprintSessionId(sessionID))
        bot._lastSessionExport = now
        log(`[ SESSION:${bot.id} ] Session export completed; registry updated.`, 'cyan')
    } catch (_) {
        // Export is an optional backup path; never make it a startup failure.
    }
}

async function autoExportSessionToEnv(bot, force = false) {
    if (!SESSION_ENV_EXPORT_ENABLED) return
    if (bot.id !== DEFAULT_BOT_ID) return exportSessionToRegistry(bot, force)

    try {
        const now = Date.now()
        if (!force && (now - bot._lastSessionExport) < SESSION_EXPORT_INTERVAL_MS) return
        if (!fs.existsSync(bot.credsPath)) return

        const sessionID = buildSessionIdFromCreds(bot)

        if (process.env.SESSION_ID?.trim() === sessionID) {
            bot._lastSessionExport = now
            return
        }

        if (fs.existsSync(envPath)) {
            const envContent = fs.readFileSync(envPath, 'utf8')

            // Do not overwrite a platform-managed secret when the local file
            // intentionally contains SESSION_ID=. The platform value must be
            // changed through the platform's secret UI, not at runtime.
            if (/^SESSION_ID=\s*$/m.test(envContent)) {
                bot._lastSessionExport = now
                return
            }

            global._suppressEnvWatcherUntil = Date.now() + 3000
            const updatedContent = /^SESSION_ID=/m.test(envContent)
                ? envContent.replace(/^SESSION_ID=.*$/m, `SESSION_ID=${sessionID}`)
                : envContent.trimEnd() + `\nSESSION_ID=${sessionID}\n`
            atomicWriteFile(envPath, updatedContent)
            process.env.SESSION_ID = sessionID
            bot.sessionId = sessionID
            rememberSessionIdFingerprint(bot, fingerprintSessionId(sessionID))
            bot._lastSessionExport = now
            log('[ SESSION_ID ] Session export completed; SQLite fingerprint updated.', 'cyan')
        }
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
        log(`[ SESSION:${bot.id} ] No sessionId or phone configured. Add one to sessions.json (or JUNE_SESSIONS) to connect this session.`, 'red', true)
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
        log(`Waiting 3 seconds for socket to stabilize... (${bot.id})`, 'yellow')
        await delay(3000)
        let code = await socket.requestPairingCode(bot.phone)
        code = code?.match(/.{1,4}/g)?.join('-') || code
        log(chalk.black.bgCyanBright(`\n🔑 [${bot.id}] Your Pairing Code: ${code}\n`), 'white')
        log(`\n1. Open WhatsApp → Settings → Linked Devices\n2. Tap "Link a Device"\n3. Enter the code above\n`, 'blue')
        return true
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
        const prefix = bot.config.prefix === '' ? 'none' : (bot.config.prefix || '.')
        const platform = detectPlatform()
        const ownerName = Array.isArray(bot.config.ownerName) ? bot.config.ownerName[0] : bot.config.ownerName

        const welcomeText = applyFont(
`┏━━━━━━✧ CONNECTED ✧━━━━━━━
┃✧ Bot: ${bot.config.botName}
┃✧ Session: ${bot.name}
┃✧ Prefix: [ ${prefix} ]
┃✧ Owner: ${ownerName}
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

// ─── .env / sessions.json File Watcher ────────────────────────────────────────

function checkEnvStatus() {
    try {
        log('[ WATCHER ] Monitoring .env and sessions.json for changes...', 'green')
        global._envWatcher = fs.watch(envPath, { persistent: false }, (eventType, filename) => {
            if (filename && eventType === 'change') {
                // Suppress restart when we ourselves wrote the session update.
                // Use a time-window (not a one-shot boolean) because fs.watch fires
                // multiple events per write on Linux/Replit.
                if (global._suppressEnvWatcherUntil && Date.now() < global._suppressEnvWatcherUntil) {
                    return
                }
                log(chalk.black.bgBlueBright('[ENV CHANGED] Restarting to apply new configuration...'), 'white')
                process.exit(1)
            }
        })
        const { SESSIONS_FILE } = require('./utils/sessionManager')
        if (fs.existsSync(SESSIONS_FILE)) {
            fs.watch(SESSIONS_FILE, { persistent: false }, (eventType, filename) => {
                if (filename && eventType === 'change') {
                    if (global._suppressEnvWatcherUntil && Date.now() < global._suppressEnvWatcherUntil) {
                        return
                    }
                    log(chalk.black.bgBlueBright('[SESSIONS CHANGED] Restarting to apply new session registry...'), 'white')
                    process.exit(1)
                }
            })
        }
    } catch (e) {
        log(`⚠️ .env watcher failed: ${e.message}`, 'yellow')
    }
}

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
    log(`[ CLEANUP:${bot.id} ] Cleared stale intervals from previous connection.`, 'yellow')

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
    log(`[ AUTH:${bot.id} ] ${authState.source === 'sqlite' ? 'SQLite' : 'file'} auth active (${authState.stats.totalKeys} signal key rows in SQLite).`, 'cyan')
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
                log(`[ AUTH:${bot.id} ] File-auth snapshot migrated to SQLite after ${trigger}; quarantine will complete on the next start.`, 'green')
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
        if (qr && bot.phone && !_pairingCodeRequested) {
            _pairingCodeRequested = true
            await requestPairingCode(sock, bot)
        }

        if (connection === 'close') {
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
                // Remember only a hash so an expired SESSION_ID cannot cause an
                // endless file-download/relogin loop on the next startup.
                const configuredSessionId = String(bot.sessionId || '').trim()
                if (configuredSessionId && VALID_PREFIXES.some((prefix) => configuredSessionId.startsWith(prefix))) {
                    markSessionIdFingerprintRevoked(bot, fingerprintSessionId(configuredSessionId))
                }
                bot.botState = 'disconnected'
                bot.connectedAt = null
                clearSessionFiles(bot)
                log(`Session cleared (${bot.id}). Returning to login flow in 10 seconds...`, 'yellow')
                for (let i = 10; i > 0; i--) {
                    log(`Restarting login in ${i}s... (${bot.id})`, 'cyan')
                    await delay(1000)
                }
                log(`Restarting login flow... (${bot.id})`, 'green')
                if (bot.phone) {
                    return fallbackToPairing(bot, `Session ${bot.id} was logged out`)
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
            bot.phone = ''  // Clear so reconnects don't re-request pairing code
            bot._fallbackToPairing = false  // pairing fallback completed
            const botNum = sock.user?.id?.split(':')[0] || 'unknown'
            bot.accountNumber = botNum
            await tryMigrateFileAuth('connection-open')
            // Auto-export the session to .env / registry so restarts never need re-login
            autoExportSessionToEnv(bot, true).catch(() => {})
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
        autoExportSessionToEnv(bot, false).catch(() => {})
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

async function fallbackToPairing(bot, reason) {
    log(`[ SESSION:${bot.id} ] ${reason} — falling back to pairing-code login.`, 'yellow')
    if (sessionExists(bot)) {
        try { quarantineCurrentSessionForReplacement(bot) } catch (_) {}
    }
    bot.sessionId = ''
    bot._fallbackToPairing = true
    bot._bootstrapRetries = 0
    bot.botState = 'connecting'
    return bootBot(bot)
}

// ─── Per-session boot flow ────────────────────────────────────────────────────

async function bootBot(bot) {
    return runInBot(bot.id, async () => {
        await bot.db.ready

        // 0. Re-read SESSION_ID directly from .env every time the default
        //    session boots so recursive calls (after logout) always see the
        //    latest value, and dotenvx quirks (which mangle long base64
        //    values) are bypassed entirely. Skipped during a pairing fallback
        //    so a revoked .env SESSION_ID cannot re-enter the loop.
        if (bot.id === DEFAULT_BOT_ID && !bot._fallbackToPairing) {
            const _freshSessionID = readSessionIDFromEnv()
            // Keep a platform-provided SESSION_ID when .env intentionally
            // contains SESSION_ID= (the normal pattern for Heroku/Replit/Railway).
            if (_freshSessionID) {
                process.env.SESSION_ID = _freshSessionID
                bot.sessionId = _freshSessionID
            }
        }

        // 1. Validate SESSION_ID format before doing anything
        const formatOk = await checkAndHandleSessionFormat(bot)
        if (!formatOk) return null

        // 2. Restore the persisted retry counter from SQLite KV.
        bot.errorRetryCount = bot.db.getSessionErrorState().count
        log(`Initial 408 retry count (${bot.id}): ${bot.errorRetryCount}`, 'yellow')

        cleanupExpiredSessionQuarantines(bot, 'startup')

        // 3. SESSION_ID is a provisioning/recovery source — never an unconditional
        // override for a verified SQLite auth state. Store only an opaque SHA-256
        // fingerprint so we can detect a genuinely changed SESSION_ID safely.
        const envSessionID = String(bot.sessionId || '').trim()
        const hasValidEnvSessionID = Boolean(
            envSessionID && VALID_PREFIXES.some((prefix) => envSessionID.startsWith(prefix))
        )
        const sqliteAuthReady = hasVerifiedSQLiteAuth(bot.db._db)
        const currentSessionFingerprint = hasValidEnvSessionID
            ? fingerprintSessionId(envSessionID)
            : null
        // SQLite session_auth_meta is the sole persistent home for opaque SHA-256
        // SESSION_ID fingerprints. The raw SESSION_ID remains environment-only.
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

        log(`[ SESSION_ID:${bot.id} ] ${hasValidEnvSessionID ? 'Configured (redacted)' : '(none)'}`, 'cyan')

        if (sessionIdRevoked) {
            if (bot.phone) {
                log(`[ SESSION_ID:${bot.id} ] This SESSION_ID was logged out by WhatsApp.`, 'red', true)
                return fallbackToPairing(bot, 'Session ID was revoked by WhatsApp')
            }
            log(`[ SESSION_ID:${bot.id} ] This SESSION_ID was logged out by WhatsApp. Add a fresh SESSION_ID, then restart.`, 'red', true)
            bot.botState = 'needs-login'
            return null
        }

        // A fingerprint mismatch is a warning, not permission to destroy a usable
        // file session. Auto-exported creds can legitimately change the raw backup
        // SESSION_ID over time. Preserve usable auth and refresh the SQLite metadata;
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
                    ? 'a forced SESSION_ID bootstrap'
                    : 'an unusable existing file session'
                log(`[ SESSION_ID:${bot.id} ] Applying ${reason} — preserving prior file auth first.`, 'yellow')
                const oldSessionPath = quarantineCurrentSessionForReplacement(bot)
                if (oldSessionPath) {
                    log(`[ SESSION:${bot.id} ] Previous file auth preserved at ${path.basename(oldSessionPath)}.`, 'yellow')
                }
            } else {
                log(`[ SESSION_ID MODE:${bot.id} ] No usable local auth found — bootstrapping from SESSION_ID.`, 'white')
            }

            if (!sessionExists(bot)) {
                log(`[ SESSION_ID:${bot.id} ] Writing creds.json from SESSION_ID...`, 'magenta')
                await fs.promises.mkdir(bot.sessionDir, { recursive: true })
                try {
                    await downloadSessionData(bot)
                    if (!hasUsableFileSession(bot)) {
                        throw new Error('creds.json was not written or is invalid after SESSION_ID bootstrap')
                    }
                    log(`[ SESSION_ID:${bot.id} ] ✅ Session bootstrap saved successfully.`, 'green')
                } catch (e) {
                    bot._bootstrapRetries = (bot._bootstrapRetries || 0) + 1
                    const multiSession = sessionManager.list().length > 1
                    // Legacy single-session keeps the original retry-forever
                    // behaviour. In multi-session mode a broken session id
                    // must not spam logs forever — park the session instead,
                    // or fall back to pairing when a phone is configured.
                    if (!bot.interactive && (multiSession || bot._bootstrapRetries >= 3)) {
                        if (bot.phone) {
                            log(`[ SESSION_ID:${bot.id} ] ❌ Bootstrap failed (${e.message}).`, 'red', true)
                            markSessionIdFingerprintRevoked(bot, fingerprintSessionId(envSessionID))
                            return fallbackToPairing(bot, 'Session ID bootstrap failed')
                        }
                        log(`[ SESSION_ID:${bot.id} ] ❌ Failed to bootstrap session: ${e.message}`, 'red', true)
                        log(`[ SESSION:${bot.id} ] Marked as needs-login — fix its sessionId in sessions.json / JUNE_SESSIONS, then restart.`, 'yellow')
                        bot.botState = 'needs-login'
                        return null
                    }
                    log(`[ SESSION_ID:${bot.id} ] ❌ Failed to bootstrap session: ${e.message}`, 'red', true)
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
            log(`[ SESSION_ID:${bot.id} ] Connecting...`, 'cyan')
            return startBotSocket(bot)
        }

        if (hasValidEnvSessionID && sqliteAuthReady) {
            if (revokedSessionFingerprints.length > 0 && !sessionIdRevoked) {
                clearRevokedSessionIdFingerprint(bot)
            }
            if (!sameSessionId) {
                // Upgrade path for an existing verified June X installation.
                rememberSessionIdFingerprint(bot, currentSessionFingerprint)
                log(`[ AUTH:${bot.id} ] Linked the existing verified SQLite auth to the configured SESSION_ID fingerprint.`, 'cyan')
            }
            log(`[ AUTH:${bot.id} ] Verified SQLite auth found; SESSION_ID is retained only as a recovery backup.`, 'green')
        } else if (hasValidEnvSessionID && usableFileSession) {
            // The file session is usable. If fingerprint metadata is absent (for
            // example after the move from marker files to session_auth_meta), adopt
            // this session instead of quarantining and recreating it.
            if (!sameSessionId && currentSessionFingerprint) {
                if (sessionIdChanged) {
                    log(`[ SESSION_ID:${bot.id} ] Configured fingerprint differs; retaining usable file auth. Set JUNE_FORCE_SESSION_BOOTSTRAP=true only for an intentional replacement.`, 'yellow')
                }
                const saved = rememberSessionIdFingerprint(bot, currentSessionFingerprint)
                if (saved) {
                    log(`[ SESSION_ID:${bot.id} ] Existing file auth adopted; fingerprint recorded in SQLite.`, 'green')
                }
            }
            if (revokedSessionFingerprints.length > 0 && !sessionIdRevoked) {
                clearRevokedSessionIdFingerprint(bot)
            }
            await bot.db.setStoredLoginMethod('session')
            log(`[ SESSION_ID:${bot.id} ] Existing usable file session retained; rebuilding SQLite auth if needed.`, 'cyan')
        } else {
            log(`[ALERT:${bot.id}] No SESSION_ID configured for this session.`, 'blue')
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

        // 6. No SESSION_ID and no stored session — login menu (interactive) or
        //    pairing / needs-login for headless and registry sessions.
        const isSoloLegacySession = sessionManager.list().length === 1 && bot.id === DEFAULT_BOT_ID
        if (!process.stdin.isTTY && isSoloLegacySession && !bot.sessionId && !bot.phone) {
            log('❌ No SESSION_ID found and no TTY available for interactive login.', 'red')
            process.exit(1)
        }

        log(chalk.black.bgYellowBright(`[ LOGIN:${bot.id} ] No SESSION_ID found and no stored session.`), 'white')
        const loginMethod = await getLoginMethod(bot)
        if (!loginMethod) return null // needs-login; session stays registered
        if (loginMethod === 'session') {
            try {
                await downloadSessionData(bot)
                if (!sessionExists(bot)) {
                    throw new Error('Session file was not written — SESSION_ID may be corrupt or expired.')
                }
                log(`[ LOGIN:${bot.id} ] ✅ Session ID accepted. Connecting...`, 'green')
            } catch (e) {
                log(`[ LOGIN:${bot.id} ] ❌ Failed to load session: ${e.message}`, 'red', true)
                log('Please check your SESSION_ID and try again. Retrying in 5 seconds...', 'yellow')
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
        if (bot.name !== `Session ${bot.id}`) bot.config.botName = bot.name
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
        // normal SESSION_ID/session startup decisions run.
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
        return `<div class="card">
      <div class="card-title">🤖 ${String(state.name).replace(/[<>&]/g, '')} <span style="color:${statusColor}">(${String(state.id).replace(/[<>&]/g, '')})</span></div>
      <div class="card-value small" style="color:${statusColor}">${statusLabel}</div>
      <div class="card-sub">${state.connected ? (state.account || '') + ' • connected ' + new Date(state.connectedAt).toLocaleTimeString() : (state.error ? 'last error: ' + String(state.error).slice(0, 90) : 'awaiting connection')}</div>
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
            const defaultBot = sessionManager.defaultBot();
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

async function restartBot(id) {
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
            try { await autoExportSessionToEnv(bot, true) } catch (_) {}
        }
        try { await juneDatabase.shutdownAllDatabases() } catch (error) {
            log(`[ SHUTDOWN ] Database flush failed: ${error.message}`, 'red', true)
        }
        log('[ SHUTDOWN ] Complete.', 'green')
    })()
    return global._shutdownPromise
}

// ─── Main Login Flow ──────────────────────────────────────────────────────────

async function main() {
    // The database uses async sql.js initialization when better-sqlite3 cannot
    // load on an older VPS. Nothing may read settings/auth/schema before this.
    await juneDatabase.ready

    const entries = loadSessionRegistry()
    const ids = entries.map((entry) => String(entry.id || DEFAULT_BOT_ID))
    const unique = [...new Set(ids)]
    if (entries.length !== unique.length) {
        log('[ MULTI-SESSION ] Duplicate session ids detected — later entries override earlier ones.', 'yellow')
    }
    log(`[ MULTI-SESSION ] ${unique.length} session(s) registered: ${unique.join(', ')}`, 'cyan')
    if (unique.length > 1) {
        log('[ MULTI-SESSION ] Multi-session mode: each session uses its own SQLite database (june-<id>.db) and auth directory.', 'cyan')
    }

    // Wire every session: database, config, remote adapters, recovery.
    for (const entry of entries) {
        const bot = sessionManager.register(entry)
        try {
            await wireBotRuntime(bot)
        } catch (error) {
            log(`[ SESSION:${bot.id} ] Runtime wiring failed: ${error?.message || error}`, 'red', true)
            bot.lastError = String(error?.message || error)
            bot.botState = 'needs-login'
        }
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
            const bot = sessionManager.defaultBot();
            return bot?.store?.[prop];
        },
    }),
    sessionManager,
}
