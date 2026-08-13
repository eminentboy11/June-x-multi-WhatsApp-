const os = require('os');
const config = require('../../config');
const database = require('../../database');
const { loadCommands } = require('../../utils/commandLoader');
const { sendButtons }  = require('gifted-btns');
const { applyFont }    = require('../../utils/fontConverter');
const { getSQLiteAuthStats } = require('../../utils/juneDb/auth-state');

const botStartTime = Date.now() - Math.floor(process.uptime() * 1000);

const detectPlatform = () => {
    if (process.env.DYNO)                               return '☁️ Heroku';
    if (process.env.RENDER)                             return '⚡ Render';
    if (process.env.REPLIT_SLUG || process.env.REPL_ID) return '🔵 Replit';
    if (process.env.P_SERVER_UUID)                      return '🖥️ Panel';
    switch (os.platform()) {
        case 'win32':  return '🪟 Windows';
        case 'darwin': return '🍎 macOS';
        case 'linux':  return '🐧 Linux';
        default:       return '❓ Unknown';
    }
};

const formatUptime = (ms) => {
    const s   = Math.floor(ms / 1000);
    const d   = Math.floor(s / 86400);
    const h   = Math.floor((s % 86400) / 3600);
    const m   = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    parts.push(`${sec}s`);
    return parts.join(' ');
};

const formatBytes = (bytes) => {
    if (bytes < 1024 * 1024)        return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
};

const formatAgo = (timestamp) => {
    const ms = Number(timestamp);
    if (!Number.isFinite(ms) || ms <= 0) return null;
    const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
};

const remoteLabel = (status) => {
    if (!status?.configured) return 'not set';
    if (status.available) return 'connected';
    return 'unavailable';
};

const getDatabaseLines = () => {
    try {
        const health = database.getDatabaseHealth() || {};
        const engine = health.ok === false ? 'SQLite degraded' : 'SQLite ready';

        let backup = 'none';
        if (health.backupExists && health.backupValid === false) {
            backup = 'invalid';
        } else if (health.backupExists) {
            const ago = formatAgo(health.lastBackup?.timestamp);
            backup = ago ? `ok · ${ago}` : 'ok';
        }

        let session = 'unknown';
        try {
            const stats = getSQLiteAuthStats(database._db);
            const keys = Number(stats?.totalKeys || 0);
            if (stats?.verified) session = `verified · ${keys} keys`;
            else if (stats?.hasCreds) session = `active · ${keys} keys`;
            else session = 'not verified';
        } catch (_) {
            session = 'unknown';
        }

        return {
            engine,
            backup,
            postgres: remoteLabel(health.postgres),
            mongo: remoteLabel(health.mongo),
            session,
        };
    } catch (_) {
        return {
            engine: 'SQLite unknown',
            backup: 'unknown',
            postgres: 'unknown',
            mongo: 'unknown',
            session: 'unknown',
        };
    }
};

module.exports = {
    name: 'botinfo',
    aliases: ['info', 'about'],
    category: 'general',
    description: 'Show detailed bot information and system stats',
    usage: '.botinfo',
    ownerOnly: false,

    async execute(sock, msg, args, extra) {
        const chatId  = extra.from;
        const prefix  = config.prefix || '.';
        const uptime  = Date.now() - botStartTime;
        const mem     = process.memoryUsage();
        const cpus    = os.cpus();
        const cpuModel = cpus[0]?.model?.trim() || 'Unknown';
        const cpuCores = cpus.length;
        const dbInfo  = getDatabaseLines();

        let cmdCount = 0;
        try { cmdCount = loadCommands().size; } catch (_) {}

        const ownerNames = Array.isArray(config.ownerName)
            ? config.ownerName.join(', ')
            : config.ownerName;

        const text = applyFont(
            `┏━━『 BOT INFORMATION 』━━\n\n` +

            `➥ Bot Name  ➜ ${config.botName}\n` +
            `➥ Prefix    ➜ ${prefix}\n` +
            `➥ Owner     ➜ ${ownerNames}\n` +
            `➥ Commands  ➜ ${cmdCount}\n` +
            `➥ Version   ➜ v${config.version || '1.0.0'}\n` +
            `➥ Node.js   ➜ ${process.version}\n\n` +

            `┃ System\n` +

            `➥ Platform  ➜ ${detectPlatform()}\n` +
            `➥ CPU       ➜ ${cpuModel}\n` +
            `➥ Cores     ➜ ${cpuCores}\n` +
            `➥ Uptime    ➜ ${formatUptime(uptime)}\n\n` +

            `┃ Memory\n` +

            `➥ Heap Used  ➜ ${formatBytes(mem.heapUsed)}\n` +
            `➥ Heap Total ➜ ${formatBytes(mem.heapTotal)}\n` +
            `➥ RAM Total  ➜ ${formatBytes(os.totalmem())}\n` +
            `➥ RAM Free   ➜ ${formatBytes(os.freemem())}\n\n` +

            `┃ Database\n` +

            `➥ Engine    ➜ ${dbInfo.engine}\n` +
            `➥ Backup    ➜ ${dbInfo.backup}\n` +
            `➥ Postgres  ➜ ${dbInfo.postgres}\n` +
            `➥ Mongo     ➜ ${dbInfo.mongo}\n` +
            `➥ Session   ➜ ${dbInfo.session}\n\n` +

            `┗━━━━━━━━━━━━━━━━`
        );

        await sendButtons(sock, chatId, {
            title:  '',
            text,
            footer: `> Powered by ${config.botName}`,
            buttons: [
                { id: `${prefix}ping`,    text: '🏓 Ping' },
                { id: `${prefix}uptime`,  text: '⏱️ Uptime' },
                { id: `${prefix}restart`, text: '🔄 Restart Bot' },
            ],
        }, { quoted: msg });
    }
};
