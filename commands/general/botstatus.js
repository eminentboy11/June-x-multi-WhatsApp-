const os = require('os');
const config = require('../../config');

function formatUptime(ms) {
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const parts = [];
    if (d) parts.push(`${d}d`);
    if (h) parts.push(`${h}h`);
    if (m) parts.push(`${m}m`);
    parts.push(`${sec}s`);
    return parts.join(' ');
}

function detectPlatform() {
    if (process.env.HEROKU) return 'Heroku';
    if (process.env.RAILWAY_STATIC_URL) return 'Railway';
    if (process.env.RENDER) return 'Render';
    if (process.env.REPLIT_DB_URL || process.env.REPL_ID) return 'Replit';
    if (process.env.P_SERVER_UUID) return 'Pterodactyl';
    const p = os.platform();
    if (p === 'linux') return 'Linux VPS';
    if (p === 'win32') return 'Windows';
    if (p === 'darwin') return 'macOS';
    return p;
}

module.exports = {
    name: 'botstatus',
    aliases: ['status', 'stats', 'run'],
    category: 'general',
    description: 'View bot status, uptime, and system info',
    usage: '.botstatus',

    async execute(sock, msg, args, extra) {
        try {
            const uptime = formatUptime(process.uptime() * 1000);
            const totalMem = (os.totalmem() / 1024 / 1024).toFixed(0);
            const usedMem = ((os.totalmem() - os.freemem()) / 1024 / 1024).toFixed(0);
            const memPercent = ((1 - os.freemem() / os.totalmem()) * 100).toFixed(1);
            const cpus = os.cpus();
            const cpuModel = cpus[0]?.model?.trim() || 'Unknown';
            const cpuCount = cpus.length;
            const platform = detectPlatform();
            const nodeVer = process.version;
            const ownerName = Array.isArray(config.ownerName) ? config.ownerName[0] : config.ownerName;
            const prefix = config.prefix === '' ? 'none' : (config.prefix || '.');
            const cmdCount = extra.getCommandCount ? extra.getCommandCount() : 'N/A';

            const speedStart = Date.now();
            const speedMs = Date.now() - (msg.messageTimestamp * 1000);

            const text = `🤖 *${config.botName} Status*\n━━━━━━━━━━━━━━━\n\n` +
                `🔸 *Uptime:* ${uptime}\n` +
                `🔸 *Speed:* ${speedMs}ms\n` +
                `🔸 *Commands:* ${cmdCount}\n` +
                `🔹 *Prefix:* [ ${prefix} ]\n` +
                `🔸 *Owner:* ${ownerName}\n\n` +
                `🔸 *System Info*\n━━━━━━━━━━━━━━━\n` +
                `🔸 *Platform:* ${platform}\n` +
                `🟢 *Node:* ${nodeVer}\n` +
                `🔸 *RAM:* ${usedMem}/${totalMem} MB (${memPercent}%)\n` +
                `🔹 *CPU:* ${cpuModel}\n` +
                `🔹 *Cores:* ${cpuCount}\n` +
                `🔹 *Timezone:* ${config.timezone || 'UTC'}\n\n` +
                `✨ *Bot Behavior*\n━━━━━━━━━━━━━━━\n` +
                `${require('../../utils/botMode').getModeLabel()} Mode\n` +
                `${config.autoRead ? '✅' : '❌'} Auto Read\n` +
                `${config.autoTyping ? '✅' : '❌'} Auto Typing\n` +
                `${config.autoReact ? '✅' : '❌'} Auto React (${config.autoReactMode || 'bot'})\n` +
                `${config.autoSticker ? '✅' : '❌'} Auto Sticker\n` +
                `${config.autoDownload ? '✅' : '❌'} Auto Download\n\n` +
                `> *${config.botName}* — Powered by Supreme`;

            await sock.sendMessage(extra.from, { text }, { quoted: msg });

        } catch (error) {
            console.error('botstatus error:', error);
            await extra.reply(`❌ Error: ${error.message}`);
        }
    }
};
