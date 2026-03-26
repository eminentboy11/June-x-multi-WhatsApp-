/**
 * Uptime Command - Show how long the bot has been running
 */

const os = require('os');
const { sendButtons } = require('gifted-btns');
const config = require('../../config');

const botStartTime = Date.now() - Math.floor(process.uptime() * 1000);

const detectPlatform = () => {
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
};

const formatUptime = (ms) => {
    const seconds = Math.floor(ms / 1000);
    const days    = Math.floor(seconds / 86400);
    const hours   = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs    = seconds % 60;
    const parts   = [];
    if (days > 0)    parts.push(`${days} day${days > 1 ? 's' : ''}`);
    if (hours > 0)   parts.push(`${hours} hour${hours > 1 ? 's' : ''}`);
    if (minutes > 0) parts.push(`${minutes} minute${minutes > 1 ? 's' : ''}`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs} second${secs !== 1 ? 's' : ''}`);
    return parts.join(', ');
};

module.exports = {
    name: 'uptime',
    aliases: ['runtime', 'botuptime'],
    category: 'general',
    description: 'Show how long the bot has been running',
    usage: '.uptime',

    async execute(sock, msg, args, extra) {
        const chatId   = extra.from;
        const platform = detectPlatform();
        const uptime   = formatUptime(Date.now() - botStartTime);
        const mem      = process.memoryUsage();
        const memUsed  = (mem.heapUsed / 1024 / 1024).toFixed(1);
        const memTotal = (mem.heapTotal / 1024 / 1024).toFixed(1);

        try {
            await sendButtons(sock, chatId, {
                text: [
                    `⏰ *${config.botName} — Uptime*`,
                    ``,
                    `⏰ *Running on* [${platform}] *for:*`,
                    `  *${uptime}*`,
                    ``,
                    `💾 *Memory:* ${memUsed}MB / ${memTotal}MB`,
                    `⚡ *Prefix:* ${config.prefix}`,
                    `🏷️ *Version:* v2.0`
                ].join('\n'),
                footer: `> Powered by ${config.botName}`,
                buttons: [
                    {
                        name: 'cta_copy',
                        buttonParamsJson: JSON.stringify({
                            display_text: '📋 Copy Menu Cmd',
                            copy_code: `${config.prefix}menu`
                        })
                    }
                ]
            }, { quoted: msg });

        } catch (error) {
            console.error('Uptime command error:', error);
            await sock.sendMessage(chatId, {
                text: [
                    `⏰ *${config.botName} — Uptime*`,
                    ``,
                    `⏰ *Running on* [${platform}] *for:*`,
                    `  *${uptime}*`,
                    ``,
                    `💾 *Memory:* ${memUsed}MB / ${memTotal}MB`,
                    `⚡ *Prefix:* ${config.prefix}`,
                    ``,
                    `> Powered by ${config.botName}`
                ].join('\n')
            }, { quoted: msg });
        }
    }
};
