const os = require('os');
const config = require('../../config');

const botStartTime = Date.now() - Math.floor(process.uptime() * 1000);

const detectPlatform = () => {
    if (process.env.DYNO) return '☁️ Heroku';
    if (process.env.RENDER) return '⚡ Render';
    
  if (process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID) return '🚉 Railway';
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

module.exports = {
    name: 'alive',
    aliases: ['botcheck', 'status'],
    category: 'general',
    description: 'Check if the bot is alive and running',
    usage: '.alive',
    ownerOnly: false,

    async execute(sock, msg, args, extra) {
        const { reply } = extra;
        const uptime = Date.now() - botStartTime;
        const mem = process.memoryUsage();
        const memUsed = (mem.heapUsed / 1024 / 1024).toFixed(1);
        const memTotal = (mem.heapTotal / 1024 / 1024).toFixed(1);

        const text = [
            ` 🍎 *Uptime:* ${formatUptime(uptime)}`,            
            ` 🔹 *Platform:* ${detectPlatform()}`,        
            ` 🔹 *Memory:* ${memUsed}MB / ${memTotal}MB`
        ].join('\n');

        await reply(text);
    }
};
