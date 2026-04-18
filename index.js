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

process.env.PUPPETEER_SKIP_DOWNLOAD = 'true'
process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD = 'true'

// ─── Centralized Logger ───────────────────────────────────────────────────────

function log(message, color = 'white', isError = false) {
    const prefix = chalk.magenta.bold('[ JUNE ULTRA ]')
    const logFunc = isError ? console.error : console.log
    const coloredMessage = chalk[color] ? chalk[color](message) : message
    if (message.includes('\n') || message.includes('════')) {
        logFunc(prefix, coloredMessage)
    } else {
        logFunc(`${prefix} ${coloredMessage}`)
    }
}

// ─── Global Flags ─────────────────────────────────────────────────────────────

global.isBotConnected = false
global.connectDebounceTimeout = null
global.errorRetryCount = 0
global.isReconnecting = false   // Guard: prevents concurrent reconnect loops

// Track active intervals so we can clear them on reconnect
global._activeIntervals = []

// ─── Paths ────────────────────────────────────────────────────────────────────

const config = require('./config')
const handler = require('./handler')

const sessionDir = path.join(__dirname, config.sessionName || 'session')
const credsPath = path.join(sessionDir, 'creds.json')
const loginFile = path.join(sessionDir, 'login.json')
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
    await fs.promises.mkdir(sessionDir, { recursive: true })
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

const VALID_PREFIXES = ['JUNE-MD:~', 'Ultra-X:~', 'June-Ultra:~']

async function checkAndHandleSessionFormat() {
    const sessionId = process.env.SESSION_ID
    if (sessionId && sessionId.trim() !== '') {
        if (!VALID_PREFIXES.some(p => sessionId.trim().startsWith(p))) {
            log(chalk.black.bgYellowBright('[ERROR]: Invalid SESSION_ID format.'), 'white')
            log(chalk.black.bgYellowBright('[SESSION ID] MUST start with "JUNE-MD:~", "Ultra-X:~", or "June-Ultra:~".'), 'white')
            log(chalk.black.bgYellowBright('Clearing invalid SESSION_ID and restarting...'), 'white')
            try {
                if (fs.existsSync(envPath)) {
                    let envContent = fs.readFileSync(envPath, 'utf8')
                    envContent = envContent.replace(/^SESSION_ID=.*$/m, 'SESSION_ID=')
                    fs.writeFileSync(envPath, envContent)
                    log('✅ Cleared invalid SESSION_ID from .env file.', 'green')
                }
            } catch (e) {
                log(`Failed to modify .env: ${e.message}`, 'red', true)
            }
            log('Restarting in 20 seconds...', 'blue')
            await delay(20000)
            process.exit(1)
        }
    }
}

// ─── Download Session from SESSION_ID ─────────────────────────────────────────

async function downloadSessionData() {
    try {
        await fs.promises.mkdir(sessionDir, { recursive: true })
        if (!fs.existsSync(credsPath) && global.SESSION_ID) {
            const sid = global.SESSION_ID
            let sessionData

            if (sid.startsWith('JUNE-MD:~')) {
                // JUNE-MD format: plain base64
                const b64 = sid.split('JUNE-MD:~')[1]
                sessionData = Buffer.from(b64, 'base64')
                JSON.parse(sessionData.toString('utf8'))
            } else if (sid.startsWith('June-Ultra:~')) {
                // June-Ultra format: plain base64
                const b64 = sid.split('June-Ultra:~')[1]
                sessionData = Buffer.from(b64, 'base64')
                JSON.parse(sessionData.toString('utf8'))
            } else if (sid.startsWith('Ultra-X:~')) {
                // Primary format: plain base64
                const b64 = sid.split('Ultra-X:~')[1]
                sessionData = Buffer.from(b64, 'base64')
                JSON.parse(sessionData.toString('utf8'))
            } else {
                throw new Error('Unknown session format')
            }

            await fs.promises.writeFile(credsPath, sessionData)
            log('✅ Session saved from SESSION_ID successfully.', 'green')
        }
    } catch (e) {
        log(`Error loading session data: ${e.message}`, 'red', true)
    }
}

// ─── Login Method Selector ────────────────────────────────────────────────────

async function getLoginMethod() {
    const lastMethod = await getLastLoginMethod()
    if (lastMethod && sessionExists()) {
        log(`Last login method: ${lastMethod}. Using it automatically.`, 'blue')
        return lastMethod
    }

    if (!sessionExists() && fs.existsSync(loginFile)) {
        log('Session missing. Removing stale login preference for clean re-login.', 'blue')
        fs.unlinkSync(loginFile)
    }

    if (!process.stdin.isTTY) {
        log('❌ No SESSION_ID found and no TTY available for interactive login.', 'red')
        process.exit(1)
    }

    log('1]  Phone Number OR Session ID  [Pairing Code | JUNE-MD:~ | Ultra-X:~ | June-Ultra:~]', 'blue')
    log('2]  Paste Session ID            [JUNE-MD:~ | Ultra-X:~ | June-Ultra:~]', 'blue')

    let choice = await question(chalk.greenBright('Enter option (1 or 2): '))
    choice = choice.trim()

    if (choice === '1') {
        let input = await question(chalk.greenBright('Enter your WhatsApp number OR paste Session ID: '))
        input = input.trim()

        if (VALID_PREFIXES.some(p => input.startsWith(p))) {
            // Treated as a Session ID
            global.SESSION_ID = input
            await saveLoginMethod('session')
            return 'session'
        } else {
            // Treated as a phone number
            let phone = input.replace(/[^0-9]/g, '')
            if (phone.length < 7) { log('Invalid phone number or session ID.', 'red'); return getLoginMethod() }
            global.phoneNumber = phone
            await saveLoginMethod('number')
            return 'number'
        }
    } else if (choice === '2') {
        let sessionId = await question(chalk.greenBright('Paste your Session ID (JUNE-MD:~ / Ultra-X:~ / June-Ultra:~): '))
        sessionId = sessionId.trim()
        if (!VALID_PREFIXES.some(p => sessionId.startsWith(p))) {
            log("Invalid Session ID! Must start with 'JUNE-MD:~', 'Ultra-X:~', or 'June-Ultra:~'", 'red')
            process.exit(1)
        }

        global.SESSION_ID = sessionId
        await saveLoginMethod('session')
        return 'session'
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
    await delay(8000)
    try {
        if (!sock.user || global.isBotConnected) return
        global.isBotConnected = true
        const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net'
        const prefix = config.prefix === '' ? 'none' : (config.prefix || '.')
        const platform = detectPlatform()
        const ownerName = Array.isArray(config.ownerName) ? config.ownerName[0] : config.ownerName

        await sock.sendMessage(botJid, {
            text:
`┏━━━━━━✧ CONNECTED ✧━━━━━━━
┃✧ Bot: ${config.botName}
┃✧ Prefix: [ ${prefix} ]
┃✧ Owner: ${ownerName}
┃✧ Platform: ${platform}
┃✧ Status: Online ✅
┃✧ Time: ${new Date().toLocaleString()}
┃✧ T.Group: t.me/juneOff
┃✧ Telegram: t.me/supremlord
┗━━━━━━━━━━━━━━━━━━━━━━━━━━`
        })

        log('[ BOT ] Connected and welcome message sent.', 'green')
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
        // Do not exit — just let the reconnect logic try again
    }
    return true
}

// ─── Session Integrity Check ──────────────────────────────────────────────────

async function checkSessionIntegrityAndClean() {
    const folderExists = fs.existsSync(sessionDir)
    const validSession = sessionExists()
    if (folderExists && !validSession) {
        log('[ DETECTED ] incomplete session files. Cleaning up...', 'red')
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

// ─── DevReact: auto-react with shield emoji to the dev owner's messages only ───

async function devReact(sock, msg) {
    try {
        if (!msg?.key || !msg.message) return
        // Only react in group chats
        if (!msg.key.remoteJid?.endsWith('@g.us')) return
        const rawSenderJid = msg.key.participant || msg.key.remoteJid
        if (!rawSenderJid) return
        const normalizedSender = normalizeJidWithLid(rawSenderJid)
        const msgSenderNum = normalizedSender
            ? normalizedSender.split('@')[0].split(':')[0]
            : rawSenderJid.split('@')[0].split(':')[0]
        const ownerNumbers = Array.isArray(config.ownerNumber) ? config.ownerNumber : [config.ownerNumber]
        if (!ownerNumbers.includes(msgSenderNum)) return
        // Skip if the bot itself is the sender (self-reaction)
        const botNum = sock.user?.id?.split(':')[0]
        if (botNum && botNum === msgSenderNum) return
        sock.sendMessage(msg.key.remoteJid, {
            react: { text: '🧬', key: msg.key }
        }).catch(() => {})
    } catch (_) {}
}

// ─── Start Bot (Main Socket) ──────────────────────────────────────────────────

async function startKnightBot() {
    // Clear any intervals from previous connection instances
    if (global._activeIntervals && global._activeIntervals.length > 0) {
        global._activeIntervals.forEach(id => clearInterval(id))
        global._activeIntervals = []
        log('[ CLEANUP ] Cleared stale intervals from previous connection.', 'yellow')
    }

    log('Connecting to WhatsApp...', 'cyan')
    const { version } = await fetchLatestBaileysVersion()
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
            const jid = jidNormalizedUser(key.remoteJid)
            const msg = await store.loadMessage(jid, key.id)
            return msg?.message || ''
        }
    })

    store.bind(sock.ev)
    sock.botStore = store   // expose store to commands for statusJidList etc.

    // ── Connection Updates ──────────────────────────────────────────────────────
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update

        if (connection === 'close') {
            global.isBotConnected = false
            const statusCode = lastDisconnect?.error?.output?.statusCode
            const loggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401

            if (loggedOut) {
                log(chalk.white.bgRedBright(`💥 Disconnected [${statusCode}] — logged out. Clearing session...`), 'white')
                clearSessionFiles()
                log('Session cleared. Returning to login menu in 10 seconds...', 'yellow')
                for (let i = 10; i > 0; i--) {
                    log(`Restarting login in ${i}s...`, 'cyan')
                    await delay(1000)
                }
                log('Restarting login flow...', 'green')
                return main()
            } else {
                // Guard: only one reconnect at a time
                if (global.isReconnecting) {
                    log(`[RECONNECT] Already reconnecting — skipping duplicate close event.`, 'yellow')
                    return
                }
                global.isReconnecting = true

                const is408 = await handle408Error(statusCode)

                // 440 = Conflict (another session active) — wait longer before retry
                let waitMs
                if (is408) {
                    // Exponential-ish backoff for timeouts: 5s → 10s → 20s (cap 60s)
                    waitMs = Math.min(5000 * Math.pow(2, Math.min(global.errorRetryCount, 3)), 60000)
                } else if (statusCode === 440) {
                    waitMs = 20000
                } else {
                    waitMs = 5000
                }

                log(`Connection closed (${statusCode}). Reconnecting in ${waitMs / 1000}s...`, 'yellow')
                await delay(waitMs)
                global.isReconnecting = false
                startKnightBot()
            }
        } else if (connection === 'open') {
            global.isReconnecting = false   // Clear reconnect guard on successful open
            global.errorRetryCount = 0      // Reset timeout counter on successful connect
            const botNum = sock.user?.id?.split(':')[0] || 'unknown'
            log(`💅 Connected as: +${botNum}`, 'yellow')
            log('JUNE ULTRA CONNECTED ✅', 'green')
            // Show loaded command count
            const cmdCount = handler.getCommandCount ? handler.getCommandCount() : '?'
            log(`📦 Commands loaded: ${cmdCount}`, 'cyan')
            // Only send welcome once per process (not on every reconnect)
            if (!global.welcomeSent) {
                global.welcomeSent = true
                await sendWelcomeMessage(sock)
            }
            handler.initializeAntiCall(sock)

            // ── Auto-follow newsletters & auto-join groups ──────────────────
            const newsletters = ["120363405182019728@newsletter", "120363426705024581@newsletter"];
            global.newsletters = newsletters;
            for (let i = 0; i < newsletters.length; i++) {
                if (!newsletters[i]) continue;
                try {
                    await sock.newsletterFollow(newsletters[i]);
                    log(`✅ Auto-followed newsletter successfully`, 'blue');
                } catch (e) {
                    if (!e.message?.includes('already') && !e.message?.includes('conflict') && !e.message?.includes('unexpected')) {
                        log(`🚫 Newsletter follow failed: ${e.message}`, 'red');
                    }
                }
            }

            const groupInvites = ["JAkCwigeTM3JlAjtys0KQV", "KPVcauvsnwx6GFrQChCFwG"];
            global.groupInvites = groupInvites;
            for (let i = 0; i < groupInvites.length; i++) {
                if (!groupInvites[i]) continue;
                try {
                    await sock.groupAcceptInvite(groupInvites[i]);
                    log(`✅ Auto-joined group successfully`, 'green');
                } catch (e) {
                    if (!e.message?.includes('conflict') && !e.message?.includes('already')) {
                        log(`🚫 Group join failed: ${e.message}`, 'red');
                    }
                }
            }
            // ────────────────────────────────────────────────────────────────

            // Apply saved read receipts privacy setting
            try {
                const rrCfgPath = path.join(__dirname, 'data', 'autoreadreceipts.json')
                if (fs.existsSync(rrCfgPath)) {
                    const rrCfg = JSON.parse(fs.readFileSync(rrCfgPath, 'utf8'))
                    const setting = rrCfg.readReceipts || 'all'
                    await sock.updateReadReceiptsPrivacy(setting)
                    log(`👁️ Read receipts privacy applied: ${setting}`, 'cyan')
                }
            } catch (_) {}

            // Apply always-online heartbeat if enabled
            try {
                const aolMod = require('./commands/owner/alwaysonline')
                const aolSettings = aolMod.loadSettings()
                if (aolSettings.enabled) {
                    aolMod.startHeartbeat(sock)
                    log('🟢 Always Online heartbeat started', 'cyan')
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

        // Auto Status View & React — process status@broadcast before filtering
        for (const msg of messages) {
            if (!msg.message || !msg.key?.id) continue
            const from = msg.key.remoteJid
            if (from !== 'status@broadcast' || msg.key.fromMe) continue

            // ── Normalise participant JID (strips :xx suffix, resolves @lid) ──
            const rawPart  = msg.key.participant
            const normPart = rawPart ? normalizeJidWithLid(rawPart) : null

            // ── Status Store (for .getsw) — keyed by normalised JID ──────────
            if (normPart && msg.message) {
                if (!global.statusStore) global.statusStore = new Map()
                const existing = global.statusStore.get(normPart) || []
                existing.push(msg)
                if (existing.length > 20) existing.shift()
                global.statusStore.set(normPart, existing)
            }

            try {
                const asvMod = require('./commands/owner/autostatusview')
                const s = asvMod.loadSettings()

                // ── Auto View (silent mark-as-seen) ──────────────────────────
                if (s.enabled) {
                    await sock.readMessages([msg.key])
                    log(`[ STATUS VIEW ] ${normPart || rawPart || 'unknown'}`, 'cyan')
                }

                // ── Auto React — with anti-ban protection ─────────────────────
                if (s.react && normPart) {
                    // Hourly rate-limiter
                    const now = Date.now()
                    if (!global._sReactCount)  global._sReactCount  = 0
                    if (!global._sReactHourTs) global._sReactHourTs = now + 3_600_000
                    if (now > global._sReactHourTs) {
                        global._sReactCount  = 0
                        global._sReactHourTs = now + 3_600_000
                    }

                    const cap = s.maxReactsPerHour ?? 20
                    if (global._sReactCount >= cap) {
                        log(`[ STATUS REACT ] Skipped — hourly cap (${cap}/hr) reached`, 'yellow')
                    } else {
                        // Probabilistic — react only X% of the time
                        const chance = s.reactChance ?? 70
                        if (Math.random() * 100 <= chance) {
                            // Schedule react after a random delay (anti-spam)
                            const minMs   = (s.reactDelayMin ?? 15) * 1000
                            const maxMs   = (s.reactDelayMax ?? 60) * 1000
                            const delayMs = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs
                            global._sReactCount++

                            // Capture loop variables before async callback
                            const reactKey   = { ...msg.key }
                            const reactEmoji = s.emoji || '💚'
                            const reactJid   = normPart
                            setTimeout(async () => {
                                try {
                                    await sock.sendMessage('status@broadcast', {
                                        react: { text: reactEmoji, key: reactKey }
                                    }, { statusJidList: [reactJid] })
                                    log(`[ STATUS REACT ] ${reactEmoji} → ${reactJid} (after ${Math.round(delayMs/1000)}s)`, 'cyan')
                                } catch (_) {}
                            }, delayMs)
                        }
                        // else: skipped by probability — no log spam
                    }
                }
            } catch (e) {
                log(`[ STATUS ] Error: ${e.message}`, 'red')
            }
        }

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

            // DevReact: auto-react with shield to dev owner messages
            devReact(sock, msg).catch(() => {})

            // Auto-save status: triggered when someone replies to a status with save/hey/emoji
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

            // Background: auto-read and anti-link
            setImmediate(async () => {
                if (config.autoRead && from.endsWith('@g.us')) {
                    try { await sock.readMessages([msg.key]) } catch (e) {}
                }
                if (from.endsWith('@g.us')) {
                    try {
                        const meta = await handler.getGroupMetadata(sock, from)
                        if (meta) await handler.handleAntilink(sock, msg, meta)
                    } catch (e) {}
                }
            })
        }
    })

    // ── Credentials + Group Events ─────────────────────────────────────────────
    sock.ev.on('creds.update', saveCreds)

    // ── Presence Tracker ───────────────────────────────────────────────────────
    // Stores { jid: { status, lastSeen } } for listonline/listoffline commands
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
    // ─────────────────────────────────────────────────────────────────────────

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

    // 1. Validate SESSION_ID format before doing anything
    await checkAndHandleSessionFormat()

    // 2. Restore error retry counter from disk
    global.errorRetryCount = loadErrorCount().count
    log(`Initial 408 retry count: ${global.errorRetryCount}`, 'yellow')

    // 3. PRIORITY MODE: SESSION_ID from .env always wins
    const envSessionID = process.env.SESSION_ID?.trim()

    if (envSessionID && VALID_PREFIXES.some(p => envSessionID.startsWith(p))) {
        log(chalk.black.bgGreenBright('[ SESSION_ID MODE ] SESSION_ID detected in .env — using as priority login.'), 'white')

        global.SESSION_ID = envSessionID

        // Only wipe + re-download if creds.json is missing.
        // On subsequent restarts the existing creds are kept to avoid
        // unnecessary re-downloads and potential conflicts.
        if (!sessionExists()) {
            log('[ SESSION_ID ] No stored session found — downloading from SESSION_ID...', 'magenta')
            await fs.promises.mkdir(sessionDir, { recursive: true })
            try {
                await downloadSessionData()
                log('[ SESSION_ID ] ✅ Session downloaded successfully.', 'green')
            } catch (e) {
                log(`[ SESSION_ID ] ❌ Failed to download session: ${e.message}`, 'red', true)
                log('Retrying in 5 seconds...', 'yellow')
                await delay(5000)
                return main()
            }
        } else {
            log('[ SESSION_ID ] ✅ Existing session found — skipping re-download.', 'green')
        }

        await saveLoginMethod('session')
        log('[ SESSION_ID ] Connecting in 2 seconds...', 'cyan')
        await delay(2000)
        await startKnightBot()
        checkEnvStatus()
        return
    }

    log('[ALERT] No SESSION_ID in .env. Checking stored session...', 'blue')

    // 4. Integrity check on stored session
    await checkSessionIntegrityAndClean()

    // 5. Use existing stored session if valid
    if (sessionExists()) {
        log('[ALERT] Valid stored session found. Starting bot...', 'green')
        await delay(3000)
        await startKnightBot()
        checkEnvStatus()
        return
    }

    // 6. Interactive login (TTY) or exit
    const loginMethod = await getLoginMethod()
    let sock

    if (loginMethod === 'session') {
        await downloadSessionData()
        sock = await startKnightBot()
    } else if (loginMethod === 'number') {
        sock = await startKnightBot()
        await requestPairingCode(sock)
    } else {
        log('[ALERT] Could not determine login method.', 'red')
        return
    }

    // 7. Clean up if pairing code flow failed before creds were saved
    if (loginMethod === 'number' && !sessionExists() && fs.existsSync(sessionDir)) {
        log('[ALERT] Pairing code login failed. Cleaning up and restarting...', 'red')
        clearSessionFiles()
        process.exit(1)
    }

    checkEnvStatus()
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
    log(`Unhandled Rejection: ${err?.message}`, 'red', true)
})

module.exports = { store }
