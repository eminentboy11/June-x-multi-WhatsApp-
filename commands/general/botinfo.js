const os = require('os');
const config = require(require('path').join(global.__ROOT__, 'config'));
const { loadCommands } = require(require('path').join(global.__CORE__, 'utils', 'commandLoader'));

const botStartTime = Date.now() - Math.floor(process.uptime() * 1000);

const detectPlatform = () => {
    if (process.env.DYNO) return '☁️ Heroku';
    if (process.env.RENDER) return '⚡ Render';
    if (process.env.REPLIT_SLUG || process.env.REPL_ID) return '🔵 Replit';
    if (process.env.P_SERVER_UUID) return '🖥️ Panel';
    switch (os.platform()) {
        case 'win32': return '🪟 Windows';
        case 'darwin': return '🍎 macOS';
        case 'linux': return '🐧 Linux';
        default: return '❓ Unknown';
    }
};

const formatUptime = (ms) => {
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    parts.push(`${sec}s`);
    return parts.join(' ');
};

const formatBytes = (bytes) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
};

module.exports = {
    name: 'botinfo',
    aliases: ['info', 'about'],
    category: 'general',
    description: 'Show detailed bot information and system stats',
    usage: '.botinfo',
    ownerOnly: false,

    async execute(sock, msg, args, extra) {
        const { reply } = extra;

        const uptime = Date.now() - botStartTime;
        const mem = process.memoryUsage();
        const cpus = os.cpus();
        const cpuModel = cpus[0]?.model?.trim() || 'Unknown';
        const cpuCores = cpus.length;

        let cmdCount = 0;
        try {
            cmdCount = loadCommands().size;
        } catch (_) {}

        const ownerNames = Array.isArray(config.ownerName) ? config.ownerName.join(', ') : config.ownerName;

        const text = [
            `  *${config.botName}* `,
            ``,
            ` 🔸 *Bot Name:* ${config.botName}`,
            ` 🔸 *Prefix:* ${config.prefix}`,
            ` 🔸 *Owner:* ${ownerNames}`,
            ` 🔸 *Commands:* ${cmdCount}`,
            ``,
            ` ⏱️ *Uptime:* ${formatUptime(uptime)}`,
            ` 🌐 *Platform:* ${detectPlatform()}`,
            ``,
            `🔹 *Heap Used:* ${formatBytes(mem.heapUsed)}`,
            `🔹 *Heap Total:* ${formatBytes(mem.heapTotal)}`,
            `🔹 *RAM Total:* ${formatBytes(os.totalmem())}`,
            `🔹 *RAM Free:* ${formatBytes(os.freemem())}`,
            `🔹 *CPU:* ${cpuModel} (${cpuCores} cores)`,
            `🔹 *Node.js:* ${process.version}`,
            ``,
            ``
        ].join('\n');

        await reply(text);
    }
};
