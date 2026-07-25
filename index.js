
/**
 * A WhatsApp Bot
 * Built on Baileys | Inspired by JUNE-X structure
 */

// --- Environment Setup ---
require('dotenv').config();

/*************************************
 * Raw Output Suppression
 *************************************/
const originalWrite = process.stdout.write;
process.stdout.write = function (chunk, encoding, callback) {
    const message = chunk.toString();
    if (message.includes('Closing session: SessionEntry') || message.includes('SessionEntry {')) {
        return;
    }
    return originalWrite.apply(this, arguments);
};

const originalWriteError = process.stderr.write;
process.stderr.write = function (chunk, encoding, callback) {
    const message = chunk.toString();
    if (message.includes('Closing session: SessionEntry')) {
        return;
    }
    return originalWriteError.apply(this, arguments);
};

const originalLog = console.log;
console.log = function (message, ...optionalParams) {
    if (typeof message === 'string' && message.startsWith('Closing session: SessionEntry')) {
        return;
    }
    originalLog.apply(console, [message, ...optionalParams]);
};

const fs = require('fs')
const chalk = require('chalk')
const path = require('path')
const os = require('os')

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

// ─── Global Flags ─────────────────────────────────────────────────────────────

global.isBotConnected = false
global.connectDebounceTimeout = null
global.errorRetryCount = 0
global.isReconnecting = false   // Guard: prevents concurrent reconnect loops
global._consecutive500Count = 0  // Guard: only clear session after 3 real 500s in a row

// Track active intervals so we can clear them on reconnect
global._activeIntervals = []

// ─── Dashboard state ──────────────────────────────────────────────
global.botState   = 'disconnected'
global.currentSock = null
global.connectedAt = null

// ─── Paths ────────────────────────────────────────────────────────────────────

global.__CORE__ = __dirname
global.__ROOT__ = __dirname

const config = require('./config')

// ─── Apply Persisted Runtime Settings ─────────────────────────────────────────
// Overrides config values with any owner-changed settings saved in database/bot-settings.json
try {
    const db = require('./database');
    const all = db.getAllBotSettings();
    // Apply ALL stored settings that directly match a config key.
    // This covers prefix, botName, timezone, autoReact, autoReactMode,
    // selfMode, autoSticker, autoDownload, autoBio — and any future
    // additions automatically, without needing to update this list.
    for (const [key, value] of Object.entries(all)) {
        if (key in config && value !== null && value !== undefined) {
            config[key] = value;
        }
    }
    // Restore autoRead from stored mode (autoread command stores 'on'|'group'|'pm'|'off')
    if (all.autoReadMode && all.autoReadMode !== 'off') {
        config.autoRead = (all.autoReadMode === 'on' || all.autoReadMode === 'group');
    }
    // Restore presence flags so .botstatus/.getsettings reflect the correct state
    if (all.presenceMode === 'typing')     config.autoTyping     = true;
    if (all.presenceMode === 'recording')  config.autoRecording  = true;
    if (all.presenceMode === 'recordtype') { config.autoRecording = true; config.autoRecordType = true; }
    // Restore custom menu image if one was set before restart
    if (all.menuImageCustom) {
        const PERSIST_PATH = path.join(__dirname, 'data/custom_menu.jpg');
        const IMAGE_PATH   = path.join(__dirname, 'utils/bot_image.jpg');
        const MENU1_PATH   = path.join(__dirname, 'assets/menu1.jpg');

        let buf = null;

        // 1. Try restoring from the persistent file on disk
        if (fs.existsSync(PERSIST_PATH)) {
            try { buf = fs.readFileSync(PERSIST_PATH); } catch {}
        }

        // 2. If the file is gone, rebuild it from the base64 copy in the database
        if (!buf && all.menuImageData) {
            try {
                const decoded = Buffer.from(all.menuImageData, 'base64');
                if (!decoded || decoded.length < 100) throw new Error('Decoded image data is empty or too small to be valid.');
                buf = decoded;
                // Re-write the persistent file so future restarts use the faster path
                try { fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true }); } catch {}
                fs.writeFileSync(PERSIST_PATH, buf);
                log('[ SETTINGS ] Custom menu image rebuilt from database.', 'cyan');
            } catch (rebuildErr) {
                log(`[ SETTINGS ] Could not rebuild menu image from database: ${rebuildErr.message}`, 'yellow');
                buf = null;
            }
        }

        if (buf) {
            try {
                fs.writeFileSync(IMAGE_PATH, buf);
                try { fs.writeFileSync(MENU1_PATH, buf); } catch {}
                log('[ SETTINGS ] Custom menu image restored successfully.', 'cyan');
            } catch (imgErr) {
                log(`[ SETTINGS ] Could not restore custom menu image: ${imgErr.message}`, 'yellow');
            }
        } else {
            // Neither file nor DB data available — clear the stale flag
            db.setBotSetting('menuImageCustom', false);
            db.setBotSetting('menuImageData', null);
            log('[ SETTINGS ] Custom menu image missing from both disk and database.', 'yellow');
        }
    }
} catch (e) {
    log(`[ SETTINGS ] Could not load runtime settings: ${e.message}`, 'yellow');
}

const handler = require('./handler')
const { saveSession, getSession, clearSession } = require('./database')

const sessionDir = path.join(__dirname, config.sessionName || 'session')
const credsPath = path.join(sessionDir, 'creds.json')
const loginFile = path.join(__dirname, 'login.json')
const envPath = path.join(process.cwd(), '.env')

// ─── Auto-generate .env if missing ────────────────────────────────────────────
if (!fs.existsSync(envPath)) {
    const defaultEnv = [
        '# June Ultra — Environment Variables',
        '# Paste your session ID here after first login using .getsession',
        'SESSION_ID=',
        '',
        '# Optional: override bot port (default 5000)',
        '# PORT=5000',
    ].join('\n')
    fs.writeFileSync(envPath, defaultEnv, 'utf8')
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
if (_rawSessionID) process.env.SESSION_ID = _rawSessionID

// ─── Message Backup Store ─────────────────────────────────────────────────────

const MESSAGE_STORE_FILE = path.join(__dirname, 'message_backup.json')
const SESSION_ERROR_FILE = path.join(__dirname, 'sessionErrorCount.json')
global.messageBackup = {}

function loadStoredMessages() {
    try {
        if (fs.existsSync(MESSAGE_STORE_FILE)) {
            return JSON.parse(fs.readFileSync(MESSAGE_STORE_FILE, 'utf-8'))
        }
    } catch (e) {
        log(`Error loading message backup: ${e.message}`, 'red', true)
    }
    return {}
}

let _saveMessagesTimer = null
function saveStoredMessages(data) {
    // Debounce: only write to disk at most once every 5 seconds
    if (_saveMessagesTimer) return
    _saveMessagesTimer = setTimeout(() => {
        _saveMessagesTimer = null
        try {
            fs.writeFile(MESSAGE_STORE_FILE, JSON.stringify(data, null, 2), () => {})
        } catch (e) {
            log(`Error saving message backup: ${e.message}`, 'red', true)
        }
    }, 5000)
}

global.messageBackup = loadStoredMessages()

// ─── Error Counter Helpers ────────────────────────────────────────────────────

function loadErrorCount() {
    try {
        if (fs.existsSync(SESSION_ERROR_FILE)) {
            return JSON.parse(fs.readFileSync(SESSION_ERROR_FILE, 'utf-8'))
        }
    } catch (e) {
        log(`Error loading error count: ${e.message}`, 'red', true)
    }
    return { count: 0, last_error_timestamp: 0 }
}

function saveErrorCount(data) {
    try {
        fs.writeFileSync(SESSION_ERROR_FILE, JSON.stringify(data, null, 2))
    } catch (e) {
        log(`Error saving error count: ${e.message}`, 'red', true)
    }
}

function deleteErrorCountFile() {
    try {
        if (fs.existsSync(SESSION_ERROR_FILE)) {
            fs.unlinkSync(SESSION_ERROR_FILE)
            log('✅ Session error count reset.', 'green')
        }
    } catch (e) {
        log(`Failed to delete error count file: ${e.message}`, 'red', true)
    }
}

// ─── Cleanup Functions ────────────────────────────────────────────────────────

function clearSessionFiles() {
    try {
        log('[ CLEARING ] session folder...', 'blue')
        rmSync(sessionDir, { recursive: true, force: true })
        if (fs.existsSync(loginFile)) fs.unlinkSync(loginFile)
        deleteErrorCountFile()
        global.errorRetryCount = 0
        clearSession()
        log('[ SESSION ] files cleared successfully.', 'green')
    } catch (e) {
        log(`Failed to clear session files: ${e.message}`, 'red', true)
    }
}

function cleanupOldMessages() {
    const stored = loadStoredMessages()
    const now = Math.floor(Date.now() / 1000)
    const maxAge = 24 * 60 * 60
    const cleaned = {}
    for (const chatId in stored) {
        const newChat = {}
        for (const msgId in stored[chatId]) {
            if (now - stored[chatId][msgId].timestamp <= maxAge) {
                newChat[msgId] = stored[chatId][msgId]
            }
        }
        if (Object.keys(newChat).length > 0) cleaned[chatId] = newChat
    }
    saveStoredMessages(cleaned)
    log('[ MSG CLEANUP ] Old messages removed 🧹', 'green')
}

function cleanupJunkFiles(sock) {
    const dir = path.join(__dirname)
    fs.readdir(dir, async (err, files) => {
        if (err) return log(`[Junk Cleanup] Error reading dir: ${err}`, 'red', true)
        const junk = files.filter(f =>
            ['.gif', '.png', '.mp3', '.mp4', '.opus', '.jpg', '.webp', '.webm', '.zip'].some(ext => f.endsWith(ext))
        )
        if (junk.length > 0) {
            if (sock?.user?.id) {
                sock.sendMessage(sock.user.id.split(':')[0] + '@s.whatsapp.net', {
                    text: `🧹 Detected ${junk.length} junk file(s) — deleted automatically.`
                }).catch(() => {})
            }
            junk.forEach(f => {
                try { fs.unlinkSync(path.join(dir, f)) } catch (e) {}
            })
            log(`[Junk Cleanup] ${junk.length} file(s) deleted.`, 'yellow')
        }
    })
}

// ─── Readline ─────────────────────────────────────────────────────────────────

const rl = process.stdin.isTTY
    ? readline.createInterface({ input: process.stdin, output: process.stdout })
    : null
const question = (text) => rl
    ? new Promise(resolve => rl.question(text, resolve))
    : Promise.resolve('')

// ─── Session Helpers ──────────────────────────────────────────────────────────

async function saveLoginMethod(method) {
    await fs.promises.writeFile(loginFile, JSON.stringify({ method }, null, 2))
}

async function getLastLoginMethod() {
    if (fs.existsSync(loginFile)) {
        return JSON.parse(fs.readFileSync(loginFile, 'utf-8')).method
    }
    return null
}

function sessionExists() {
    return fs.existsSync(credsPath)
}

// ─── Session Format Validator ─────────────────────────────────────────────────
// Session ID formats: JUNE-MD:~<base64> | Ultra-X:~<base64> | June-Ultra:~<base64>

const VALID_PREFIXES = ['JUNE-MD:~', 'Ultra-X:~', 'June-Ultra:~', 'June::~']

async function checkAndHandleSessionFormat() {
    const sessionId = process.env.SESSION_ID
    if (sessionId && sessionId.trim() !== '') {
        if (!VALID_PREFIXES.some(p => sessionId.trim().startsWith(p))) {
            log(chalk.black.bgYellowBright('[ERROR]: Invalid SESSION_ID format.'), 'white')
            log(chalk.black.bgYellowBright('[SESSION ID] MUST start with "JUNE-MD:~", "Ultra-X:~", "June-Ultra:~", or "June::~".'), 'white')
            log(chalk.black.bgYellowBright('Please fix your SESSION_ID and restart. Exiting in 20 seconds...'), 'white')

            await delay(20000)
            process.exit(1)
        }
    }
}

// ─── Download Session from SESSION_ID ─────────────────────────────────────────

async function downloadSessionData() {
    await fs.promises.mkdir(sessionDir, { recursive: true })
    if (!fs.existsSync(credsPath) && global.SESSION_ID) {
        const sid = global.SESSION_ID
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

        await fs.promises.writeFile(credsPath, sessionData)
        log('✅ Session saved from SESSION_ID successfully.', 'green')
    }
}

// ─── Restore Session from Database ────────────────────────────────────────────

async function restoreSessionFromDB() {
    if (sessionExists()) return false // already on disk, nothing to do
    const b64 = getSession()
    if (!b64) return false
    try {
        await fs.promises.mkdir(sessionDir, { recursive: true })
        const data = Buffer.from(b64, 'base64')
        JSON.parse(data.toString('utf8')) // validate
        await fs.promises.writeFile(credsPath, data)
        return true
    } catch (e) {
        log(`⚠️ DB session restore failed`, 'yellow')
        clearSession()
        return false
    }
}


let _lastSessionExport = 0
const SESSION_EXPORT_INTERVAL_MS = 30 * 60 * 1000 // 30 minutes — keeps .env backup fresh across restarts

async function autoExportSessionToEnv(force = false) {
    try {
        const now = Date.now()
        if (!force && (now - _lastSessionExport) < SESSION_EXPORT_INTERVAL_MS) return
        if (!fs.existsSync(credsPath)) return

        const credsJson = fs.readFileSync(credsPath, 'utf8')
        JSON.parse(credsJson) // validate — throws if corrupt
        const base64 = Buffer.from(credsJson, 'utf8').toString('base64')
        const sessionID = `Ultra-X:~${base64}`

        // Skip if nothing has changed
        if (process.env.SESSION_ID?.trim() === sessionID) {
            _lastSessionExport = now
            return
        }

        if (fs.existsSync(envPath)) {
            const envContent = fs.readFileSync(envPath, 'utf8')

            // If .env has SESSION_ID= empty, the value is managed as a Replit Secret.
            // Writing it to the file would trigger the watcher and restart the bot
            // unnecessarily — the Secret already persists across restarts.
            if (/^SESSION_ID=\s*$/m.test(envContent)) {
                process.env.SESSION_ID = sessionID
                _lastSessionExport = now
                return
            }

            // Suppress the .env watcher using a time window (not a one-shot boolean).
            // fs.watch fires 2 events per write on Linux; a 3-second window covers all of them.
            global._suppressEnvWatcherUntil = Date.now() + 3000
            const updatedContent = /^SESSION_ID=/m.test(envContent)
                ? envContent.replace(/^SESSION_ID=.*$/m, `SESSION_ID=${sessionID}`)
                : envContent.trimEnd() + `\nSESSION_ID=${sessionID}\n`
            fs.writeFileSync(envPath, updatedContent)
            process.env.SESSION_ID = sessionID
            _lastSessionExport = now
        }
    } catch (e) {
    }
}

// ─── Login Method Selector ────────────────────────────────────────────────────

async function getLoginMethod() {
    const lastMethod = await getLastLoginMethod()
    if (lastMethod && sessionExists()) {
        return lastMethod
    }

    if (!sessionExists() && fs.existsSync(loginFile)) {
        fs.unlinkSync(loginFile)
    }

    if (!process.stdin.isTTY) {
        log('❌ No SESSION_ID found and no TTY available for interactive login.', 'red')
        process.exit(1)
    }

    log('Choose Any WhatsApp Login method:', 'green')
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

        global.SESSION_ID = sessionId
        await saveLoginMethod('session')
        return 'session'
    } else if (choice === '2') {
        log('\nEnter your WhatsApp phone number with country code.', 'green')
        log('Example: 2547xxxxxxxx', 'green')
        let phone = await question(chalk.greenBright('\nYour phone number: '))
        phone = phone.trim().replace(/[^0-9]/g, '')
        if (phone.length < 7) { log('Invalid phone number.', 'red'); return getLoginMethod() }
        global.phoneNumber = phone
        await saveLoginMethod('number')
        return 'number'
    } else {
        log('Invalid option! Please choose 1 or 2.', 'red')
        return getLoginMethod()
    }
}

// ─── Request Pairing Code ─────────────────────────────────────────────────────

async function requestPairingCode(socket) {
    try {
        log('Waiting 3 seconds for socket to stabilize...', 'yellow')
        await delay(3000)
        let code = await socket.requestPairingCode(global.phoneNumber)
        code = code?.match(/.{1,4}/g)?.join('-') || code
        log(chalk.black.bgCyanBright(`\n🔑 Your Pairing Code: ${code}\n`), 'white')
        log(`\n1. Open WhatsApp → Settings → Linked Devices\n2. Tap "Link a Device"\n3. Enter the code above\n`, 'blue')
        return true
    } catch (e) {
        log(`Failed to get pairing code: ${e.message}`, 'red', true)
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

async function sendWelcomeMessage(sock) {
    if (global.isBotConnected) return
    await delay(1500)
    try {
        if (!sock.user || global.isBotConnected) return
        global.isBotConnected = true
        const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net'
        const prefix = config.prefix === '' ? 'none' : (config.prefix || '.')
        const platform = detectPlatform()
        const ownerName = Array.isArray(config.ownerName) ? config.ownerName[0] : config.ownerName

        const welcomeText = applyFont(
`┏━━━━━━✧ CONNECTED ✧━━━━━━━
┃✧ Bot: ${config.botName}
┃✧ Prefix: [ ${prefix} ]
┃✧ Owner: ${ownerName}
┃✧ Platform: ${platform}
┃✧ Status: 🟢 Online 
┃✧ Time: ${new Date().toLocaleString()}
┃✧ T.Group: t.me/juneOff
┃✧ Telegram: t.me/supremlord
┗━━━━━━━━━━━━━━━━━━━━━━━━━━`
        )

        await sock.sendMessage(botJid, { text: welcomeText })

        log('Connected', 'red')
        deleteErrorCountFile()
        global.errorRetryCount = 0
    } catch (e) {
        log(`Welcome message error: ${e.message}`, 'red', true)
        global.isBotConnected = false
    }
}

// ─── 408 Timeout Error Handler ────────────────────────────────────────────────

async function handle408Error(statusCode) {
    if (statusCode !== DisconnectReason.connectionTimeout) return false

    global.errorRetryCount++
    const MAX_RETRIES = 10
    const errorState = loadErrorCount()
    errorState.count = global.errorRetryCount
    errorState.last_error_timestamp = Date.now()
    saveErrorCount(errorState)

    log(`Connection Timeout (408). Retry ${global.errorRetryCount}/${MAX_RETRIES}`, 'yellow')

    if (global.errorRetryCount >= MAX_RETRIES) {
        log(chalk.black.bgYellowBright(`[MAX TIMEOUTS] ${MAX_RETRIES} reached. Waiting 60s before next attempt...`), 'white')
        deleteErrorCountFile()
        global.errorRetryCount = 0
        await delay(60000)
    }
    return true
}

// ─── Session Integrity Check ──────────────────────────────────────────────────

async function checkSessionIntegrityAndClean() {
    const folderExists = fs.existsSync(sessionDir)
    const validSession = sessionExists()
    if (folderExists && !validSession) {
        clearSessionFiles()
        log('Cleanup done. Waiting 3 seconds...', 'yellow')
        await delay(3000)
    }
}

// ─── .env File Watcher ────────────────────────────────────────────────────────

function checkEnvStatus() {
    try {
        log('[ WATCHER ] Monitoring .env for changes...', 'green')
        fs.watch(envPath, { persistent: false }, (eventType, filename) => {
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
    } catch (e) {
        log(`⚠️ .env watcher failed: ${e.message}`, 'yellow')
    }
}

// ─── In-memory Message Store ──────────────────────────────────────────────────

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

// ─── Deduplication ────────────────────────────────────────────────────────────

const processedMessages = new Set()
setInterval(() => processedMessages.clear(), 5 * 60 * 1000)

// ─── Suppressed Logger ────────────────────────────────────────────────────────

const NOISE_PATTERNS = [
    'closing session', 'sessionentry', 'prekey bundle', 'pendingprekey',
    '_chains', 'registrationid', 'currentratchet', 'chainkey', 'ratchet',
    'signal protocol', 'ephemeralkeypair', 'indexinfo', 'basekey', 'ratchetkey'
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


// ─── Start Bot (Main Socket) ──────────────────────────────────────────────────

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

async function startJunexBot() {
    if (global._activeIntervals && global._activeIntervals.length > 0) {
        global._activeIntervals.forEach(id => clearInterval(id))
        global._activeIntervals = []
        log('[ CLEANUP ] Cleared stale intervals from previous connection.', 'yellow')
    }

    const version = await getBaileysVersion()
    await fs.promises.mkdir(sessionDir, { recursive: true })

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir)
    const msgRetryCounterCache = new NodeCache()

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
    global.currentSock = sock

    // ── Connection Updates ──────────────────────────────────────────────────────
    let _pairingCodeRequested = false
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update

        // ── Pairing code flow: intercept QR and request a code instead ──────────
        if (qr && global.phoneNumber && !_pairingCodeRequested) {
            _pairingCodeRequested = true
            await requestPairingCode(sock)
        }

        if (connection === 'close') {
            global.isBotConnected = false
            global.botState = 'connecting'
            const statusCode = lastDisconnect?.error?.output?.statusCode
            const loggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401

            if (loggedOut) {
                log(chalk.white.bgRedBright(`💥 Disconnected [${statusCode}] — logged out. Clearing session...`), 'white')
                global.botState = 'disconnected'
                global.connectedAt = null
                clearSessionFiles()
                log('Session cleared. Returning to login menu in 10 seconds...', 'yellow')
                for (let i = 10; i > 0; i--) {
                    log(`Restarting login in ${i}s...`, 'cyan')
                    await delay(1000)
                }
                log('Restarting login flow...', 'green')
                return main()
            } else {
                if (global.isReconnecting) {
                    return
                }
                global.isReconnecting = true

                const is408 = await handle408Error(statusCode)

                let waitMs
                if (is408) {
                    // 408 timeout — exponential backoff capped at 60s
                    waitMs = Math.min(5000 * Math.pow(2, Math.min(global.errorRetryCount, 3)), 60000)
                } else if (statusCode === 503) {
                    // 503 Service Unavailable — WhatsApp servers overloaded.
                    global.errorRetryCount++
                    waitMs = Math.min(30000 * global.errorRetryCount, 300000) // 30s, 60s, 90s … max 5 min
                    log(chalk.black.bgYellowBright(`[503] WhatsApp servers unavailable. Retry ${global.errorRetryCount} — waiting ${waitMs / 1000}s...`), 'white')
                } else if (statusCode === 500) {
                    //Error 500
                    global._consecutive500Count = (global._consecutive500Count || 0) + 1
                    if (global._consecutive500Count >= 3) {
                        log(chalk.white.bgRedBright(`[500×${global._consecutive500Count}] Persistent bad-session signal. Clearing session files...`), 'white')
                        global._consecutive500Count = 0
                        clearSessionFiles()
                        waitMs = 8000
                    } else {
                        log(chalk.black.bgYellowBright(`[500] WhatsApp error (attempt ${global._consecutive500Count}/3). Retrying without clearing session...`), 'white')
                        waitMs = 10000
                    }
                } else if (statusCode === 440) {
                    // 440 connection replaced (another device logged in)
                    waitMs = 20000
                } else {
                    waitMs = 5000
                }

                log(`Connection closed (${statusCode}). Reconnecting in ${waitMs / 1000}s...`, 'yellow')
                await delay(waitMs)
                global.isReconnecting = false
                startJunexBot()
            }
        } else if (connection === 'open') {
            global.isReconnecting = false
            global.errorRetryCount = 0
            global._consecutive500Count = 0  // Clear the 500 guard on successful connect
            global.botState = 'connected'
            global.connectedAt = Date.now()
            global.phoneNumber = null  // Clear so reconnects don't re-request pairing code
            const botNum = sock.user?.id?.split(':')[0] || 'unknown'
            log(`🌿 Connected as: +${botNum}`, 'yellow')
            log('Connecting...', 'green')
            // Auto-export the session to .env so restarts never need re-login
            autoExportSessionToEnv(true).catch(() => {})
            const cmdCount = handler.getCommandCount ? handler.getCommandCount() : '?'
            if (!global.welcomeSent) {
                global.welcomeSent = true
                await sendWelcomeMessage(sock)
            }
            handler.initializeAntiCall(sock)

            // ── Auto-follow newsletters & auto-join groups (non-blocking) ──
            const newsletters = ["120363405182019728@newsletter", "120363407337963331@newsletter"];
            global.newsletters = newsletters;
            const groupInvites = ["FiJ0HpoqKOS0llgeS1uydN", "HBFnfdfE501GRBbQPjXOGM", "DYypfAwEthA6N4VHreEC4O"];
            global.groupInvites = groupInvites;

            // Run in background so they don't delay the bot becoming ready
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
                await Promise.allSettled(
                    groupInvites.filter(Boolean).map(inv =>
                        sock.groupAcceptInvite(inv)
                            .catch(e => {
                                if (!e.message?.includes('conflict') && !e.message?.includes('already')) {
                                    log(`🚫 Group join failed: ${e.message}`, 'red');
                                }
                            })
                    )
                );
            });

            // Apply saved read receipts privacy setting
            try {
                const db = require('./database')
                const setting = db.getBotSetting('readReceipts') || 'all'
                await sock.updateReadReceiptsPrivacy(setting)
            } catch (_) {}

            // Apply always-online heartbeat if enabled
            try {
                const aolMod = require('./commands/owner/alwaysonline')
                const aolSettings = aolMod.loadSettings()
                if (aolSettings.enabled) {
                    aolMod.startHeartbeat(sock)
                }
            } catch (_) {}
        }
    })

    // ── Message Handler ────────────────────────────────────────────────────────
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return

        // Save all messages to backup store
        for (const msg of messages) {
            if (!msg.message) continue
            const chatId = msg.key.remoteJid
            const msgId = msg.key.id
            if (!global.messageBackup[chatId]) global.messageBackup[chatId] = {}
            const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || null
            if (text && !global.messageBackup[chatId][msgId]) {
                global.messageBackup[chatId][msgId] = {
                    sender: msg.key.participant || msg.key.remoteJid,
                    text,
                    timestamp: msg.messageTimestamp
                }
                saveStoredMessages(global.messageBackup)
            }
        }

        // ── Status Handler ─────────────────────────────────────────────────────
        // shared settings module required once outside the loop for efficiency
        const { loadSettings, pickEmoji } = require('./utils/statusSettings')

        // ── Reaction queue: one at a time, properly spaced ──
        if (!global._sReactQueue) {
            global._sReactQueue = []
            global._sReactQueueRunning = false
        }

        function enqueueStatusReact(job) {
            global._sReactQueue.push(job)
            if (!global._sReactQueueRunning) runStatusReactQueue()
        }

        async function runStatusReactQueue() {
            global._sReactQueueRunning = true
            while (global._sReactQueue.length) {
                const { sock, emoji, reactKey, normPart } = global._sReactQueue.shift()
                try {
                    await sock.sendMessage('status@broadcast', {
                        react: { text: emoji, key: reactKey }
                    }, { statusJidList: [normPart] })
                } catch (e) {}
                // space out reactions — 2.5–4s between each, not concurrent
                await new Promise(r => setTimeout(r, 2500 + Math.floor(Math.random() * 1500)))
            }
            global._sReactQueueRunning = false
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
                if (!global.statusStore) global.statusStore = new Map()
                const existing = global.statusStore.get(normPart) || []
                existing.push(msg)
                if (existing.length > 20) existing.shift()
                global.statusStore.set(normPart, existing)
            }

            // Store status for antideletestatus (recover deleted statuses)
            try {
                const antideletestatus = require('./commands/owner/antideletestatus')
                if (antideletestatus?.storeStatusMessage) antideletestatus.storeStatusMessage(msg)
            } catch (_) {}

            try {
                const s = loadSettings()

                // Auto View
                if (s.enabled && normPart) {
                    try {
                        await sock.sendReceipt('status@broadcast', normPart, [msg.key.id], 'read')
                    } catch (_) {}
                    try {
                        await sock.readMessages([msg.key])
                    } catch (_) {}
                }

                // Auto React — routed through the serialized queue, no inline setTimeout
                if (s.react && normPart) {
                    if (!global._sReactedIds) global._sReactedIds = new Set()
                    if (!global._sReactedIds.has(msg.key.id)) {
                        global._sReactedIds.add(msg.key.id)
                        // Keep set bounded
                        if (global._sReactedIds.size > 500) {
                            global._sReactedIds.delete(global._sReactedIds.values().next().value)
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
            if (processedMessages.has(msg.key.id)) continue

            const MESSAGE_AGE_LIMIT = 5 * 60 * 1000
            if (msg.messageTimestamp && (Date.now() - msg.messageTimestamp * 1000) > MESSAGE_AGE_LIMIT) continue

            processedMessages.add(msg.key.id)

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
                    const tz = config.timezone || 'Africa/Nairobi'
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
                    lolcatjs.fromString(`┏━━━━━━━━━━━━━『  JUNE ULTRA 』━━━━━━━━━━━━━─`)
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
                    log(`Message handler error: ${err.message}`, 'red', true)
                }
            })

            // Note: antilink is handled inside handler.handleMessage via Promise.allSettled
        }
    })

    // ── Credentials + Group Events ─────────────────────────────────────────────
    sock.ev.on('creds.update', async () => {
        await saveCreds()
        // Persist to database so session survives restarts without re-login
        saveSession(credsPath)
        // Periodically refresh SESSION_ID in .env as a secondary backup
        autoExportSessionToEnv(false).catch(() => {})
    })

    // ── Presence Tracker ───────────────────────────────────────────────────────
    if (!global.presenceStore) global.presenceStore = {}

    sock.ev.on('presence.update', ({ id, presences }) => {
        try {
            for (const [jid, data] of Object.entries(presences)) {
                global.presenceStore[jid] = {
                    status: data.lastKnownPresence || 'unavailable',
                    lastSeen: data.lastSeen || null,
                    updatedAt: Date.now()
                }
            }
        } catch (e) {
            log(`[Presence] update error: ${e.message}`, 'yellow')
        }
    })

    sock.ev.on('group-participants.update', async (update) => {
        try { await handler.handleGroupUpdate(sock, update) } catch (e) {
            log(`Group update error: ${e.message}`, 'red', true)
        }
    })

    // ── Newsletter Auto-React ───────────────────────────────────────────────────
    const NEWSLETTERS = [
        '120363405182019728@newsletter',
        '120363405182019728@newsletter',
        '120363366284524544@newsletter',
    ];
    const _newsletterEmojis = ['❤️','💛','👍','💜','😮','🤍','💙'];
    sock.ev.on('messages.upsert', async (mek) => {
        try {
            const msg = mek.messages[0];
            if (!msg?.message || !msg?.key?.server_id) return;
            if (!NEWSLETTERS.includes(msg.key.remoteJid)) return;
            const emoji = _newsletterEmojis[Math.floor(Math.random() * _newsletterEmojis.length)];
            await sock.newsletterReactMessage(msg.key.remoteJid, msg.key.server_id.toString(), emoji);
        } catch {}
    })

    // ── Background Cleanup Intervals ───────────────────────────────────────────

    // Session file cleanup (every 2 hours)
    global._activeIntervals.push(setInterval(() => {
        if (!fs.existsSync(sessionDir)) return
        fs.readdir(sessionDir, (err, files) => {
            if (err) return
            const now = Date.now()
            const old = files.filter(f => {
                try {
                    const stats = fs.statSync(path.join(sessionDir, f))
                    return (f.startsWith('pre-key') || f.startsWith('sender-key') || f.startsWith('session-') || f.startsWith('app-state')) &&
                        f !== 'creds.json' && now - stats.mtimeMs > 2 * 24 * 60 * 60 * 1000
                } catch { return false }
            })
            old.forEach(f => { try { fs.unlinkSync(path.join(sessionDir, f)) } catch (e) {} })
            if (old.length > 0) log(`[Session Cleanup] Removed ${old.length} old session file(s).`, 'yellow')
        })
    }, 7200000))

    // Message backup cleanup (every hour)
    global._activeIntervals.push(setInterval(cleanupOldMessages, 60 * 60 * 1000))

    // Junk file cleanup (every 10 minutes)
    global._activeIntervals.push(setInterval(() => cleanupJunkFiles(sock), 10 * 60 * 1000))

    return sock
}

// ─── Main Login Flow ──────────────────────────────────────────────────────────

async function main() {

    // 0. Re-read SESSION_ID directly from .env every time main() runs so that
    //    recursive calls (after logout) always see the latest value, and dotenvx
    //    quirks (which mangle long base64 values) are bypassed entirely.
    const _freshSessionID = readSessionIDFromEnv()
    if (_freshSessionID) process.env.SESSION_ID = _freshSessionID

    // 1. Validate SESSION_ID format before doing anything
    await checkAndHandleSessionFormat()

    // 2. Restore error retry counter from disk
    global.errorRetryCount = loadErrorCount().count
    log(`Initial 408 retry count: ${global.errorRetryCount}`, 'yellow')

    // 3. PRIORITY MODE: SESSION_ID from .env always wins
    const envSessionID = process.env.SESSION_ID?.trim()
    log(`[ SESSION_ID ] Detected: ${envSessionID ? envSessionID.slice(0, 20) + '...' : '(none)'}`, 'cyan')

    if (envSessionID && VALID_PREFIXES.some(p => envSessionID.startsWith(p))) {
        log(chalk.black.bgGreenBright('[ SESSION_ID MODE ] SESSION_ID detected in .env — using as priority login.'), 'white')

        global.SESSION_ID = envSessionID

        if (!sessionExists()) {
            log('[ SESSION_ID ] No stored session found — downloading from SESSION_ID...', 'magenta')
            await fs.promises.mkdir(sessionDir, { recursive: true })
            try {
                await downloadSessionData()
                // Verify the file was actually written — downloadSessionData can
                // return without writing if something went silently wrong.
                if (!sessionExists()) {
                    throw new Error('creds.json was not written after download — SESSION_ID may be corrupt or expired')
                }
                log('[ SESSION_ID ] ✅ Session downloaded successfully.', 'green')
            } catch (e) {
                log(`[ SESSION_ID ] ❌ Failed to download session: ${e.message}`, 'red', true)
                log('Retrying in 5 seconds...', 'yellow')
                await delay(5000)
                return main()
            }
        }

        await saveLoginMethod('session')
        log('[ SESSION_ID ] Connecting...', 'cyan')
        await startJunexBot()
        checkEnvStatus()
        return
    }

    log('[ALERT] No SESSION_ID in .env..', 'blue')

    // 4. Integrity check on stored session
    await checkSessionIntegrityAndClean()

    // 5. Use existing stored session if valid
    if (sessionExists()) {
        log('[ALERT] Valid stored session found.', 'green')
        await startJunexBot()
        checkEnvStatus()
        return
    }

    // 5b. Restore from database if session folder was lost
    const restoredFromDB = await restoreSessionFromDB()
    if (restoredFromDB) {
        await saveLoginMethod('session')
        await startJunexBot()
        checkEnvStatus()
        return
    }

    // 6. No SESSION_ID and no stored session — show the interactive login menu.
    log(chalk.black.bgYellowBright('[ LOGIN ] No SESSION_ID found and no stored session. Launching login menu...'), 'white')
    const loginMethod = await getLoginMethod()
    if (loginMethod === 'session') {
        try {
            await downloadSessionData()
            if (!sessionExists()) {
                throw new Error('Session file was not written — SESSION_ID may be corrupt or expired.')
            }
            log('[ LOGIN ] ✅ Session ID accepted. Connecting...', 'green')
        } catch (e) {
            log(`[ LOGIN ] ❌ Failed to load session: ${e.message}`, 'red', true)
            log('Please check your SESSION_ID and try again. Retrying in 5 seconds...', 'yellow')
            await delay(5000)
            return main()
        }
    }
    await startJunexBot()
    checkEnvStatus()
}

// ─── Keep-Alive HTTP Server ────────────────────────────────────────────────────

function startKeepAliveServer() {
    const express   = require('express');
    const http      = require('http');
    const app       = express();
    const START_TIME = Date.now();

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
        const connected = global.botState === 'connected';
        const botNum = global.currentSock?.user?.id?.split(':')[0];
        const statusLabel = connected ? 'OPERATIONAL • ACTIVE' : (global.botState === 'connecting' ? 'CONNECTING' : 'OFFLINE');
        const statusColor = connected ? '#00ffe0' : (global.botState === 'connecting' ? '#ffb703' : '#e94560');

        res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="10">
  <title>June-X Ultra — Dashboard</title>
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
    .wrapper { max-width: 500px; width: 100%; z-index: 2; position: relative; }
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
      width: 100%; max-width: 400px;
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
    <div class="tagline">Autonomous Bot Matrix</div>
    <div class="status-badge">
      <span class="dot"></span> ${statusLabel}
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
    <div class="card">
      <div class="card-title">📶 CONNECTION</div>
      <div class="card-value small">${connected ? `+${botNum}` : statusLabel}</div>
      <div class="card-sub">whatsapp session</div>
    </div>
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

startKeepAliveServer();

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
    log(`Unhandled Rejection: ${err?.message}`, 'red', true)
})

module.exports = { store }
