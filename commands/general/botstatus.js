const os = require('os');
const config = require('../../config');
const database = require('../../database');
const { sendButtons }  = require('gifted-btns');
const { applyFont }    = require('../../utils/fontConverter');
const { loadCommands } = require('../../utils/commandLoader');

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatUptime(ms) {
    const s   = Math.floor(ms / 1000);
    const d   = Math.floor(s / 86400);
    const h   = Math.floor((s % 86400) / 3600);
    const m   = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const parts = [];
    if (d) parts.push(`${d}d`);
    if (h) parts.push(`${h}h`);
    if (m) parts.push(`${m}m`);
    parts.push(`${sec}s`);
    return parts.join(' ');
}

function detectPlatform() {
    if (process.env.HEROKU)                               return '☁️ Heroku';
    if (process.env.RAILWAY_STATIC_URL)                   return '🚉 Railway';
    if (process.env.RENDER)                               return '⚡ Render';
    if (process.env.REPLIT_DB_URL || process.env.REPL_ID) return '🔵 Replit';
    if (process.env.P_SERVER_UUID)                        return '🖥️ Pterodactyl';
    const p = os.platform();
    if (p === 'linux')  return '🐧 Linux VPS';
    if (p === 'win32')  return '🪟 Windows';
    if (p === 'darwin') return '🍎 macOS';
    return p;
}

function extractButtonResponseId(msg) {
    return (
        msg.message?.buttonsResponseMessage?.selectedButtonId ||
        msg.message?.templateButtonReplyMessage?.selectedId ||
        msg.message?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson ||
        null
    );
}

function getResponseSender(msg) {
    return msg.key?.participant || msg.key?.remoteJid;
}

// ── Module ────────────────────────────────────────────────────────────────────

module.exports = {
    name: 'botstatus',
    aliases: ['status', 'stats', 'run'],
    category: 'general',
    description: 'View bot status, uptime, and system info',
    usage: '.botstatus',

    async execute(sock, msg, args, extra) {
        try {
            const chatId         = extra.from;
            const prefix         = config.prefix === '' ? 'none' : (config.prefix || '.');
            const originalSender = msg.key?.participant || msg.key?.remoteJid;
            const dateNow        = Date.now();

            // ── Gather stats ──────────────────────────────────────────────────
            const uptime     = formatUptime(process.uptime() * 1000);
            const totalMem   = (os.totalmem() / 1024 / 1024).toFixed(0);
            const usedMem    = ((os.totalmem() - os.freemem()) / 1024 / 1024).toFixed(0);
            const memPercent = ((1 - os.freemem() / os.totalmem()) * 100).toFixed(1);
            const cpus       = os.cpus();
            const cpuModel   = cpus[0]?.model?.trim() || 'Unknown';
            const cpuCount   = cpus.length;
            const platform   = detectPlatform();
            const nodeVer    = process.version;
            const ownerName  = Array.isArray(config.ownerName) ? config.ownerName[0] : config.ownerName;
            const cmdCount   = extra.getCommandCount ? extra.getCommandCount() : 'N/A';
            const speedMs    = Date.now() - (msg.messageTimestamp * 1000);
            const autoDownloadStatus = database.getAutoDownloadStatusSettings();
            const { getModeLabel } = require('../../utils/botMode');

            const text = applyFont(
                `┏━━『 BOT STATUS 』━━\n\n` +

                `➥ Bot Name  ➜ ${config.botName}\n` +
                `➥ Prefix    ➜ [ ${prefix} ]\n` +
                `➥ Owner     ➜ ${ownerName}\n` +
                `➥ Commands  ➜ ${cmdCount}\n` +
                `➥ Uptime    ➜ ${uptime}\n` +
                `➥ Speed     ➜ ${speedMs}ms\n\n` +

                `┃ System\n` +

                `➥ Platform  ➜ ${platform}\n` +
                `➥ Node.js   ➜ ${nodeVer}\n` +
                `➥ RAM       ➜ ${usedMem}/${totalMem} MB (${memPercent}%)\n` +
                `➥ CPU       ➜ ${cpuModel}\n` +
                `➥ Cores     ➜ ${cpuCount}\n` +
                `➥ Timezone  ➜ ${config.timezone || 'UTC'}\n\n` +

                `┃ Behavior\n` +

                `➥ Mode          ➜ ${getModeLabel()}\n` +
                `➥ Auto Read     ➜ ${config.autoRead      ? '✅' : '❌'}\n` +
                `➥ Auto Typing   ➜ ${config.autoTyping    ? '✅' : '❌'}\n` +
                `➥ Auto React    ➜ ${config.autoReact     ? '✅' : '❌'} (${config.autoReactMode || 'bot'})\n` +
                `➥ Auto Sticker  ➜ ${config.autoSticker   ? '✅' : '❌'}\n` +
                `➥ Auto Download ➜ ${autoDownloadStatus.enabled ? `✅ (${autoDownloadStatus.mode})` : '❌'}\n\n` +

                `┗━━━━━━━━━━━━━━━━`
            );

            await sendButtons(sock, chatId, {
                title:  '',
                text,
                footer: `> Powered by ${config.botName}`,
                buttons: [
                    { id: `${prefix}ping_${dateNow}`,    text: '🏓 Ping'    },
                    { id: `${prefix}uptime_${dateNow}`,  text: '⏱️ Uptime'  },
                    { id: `${prefix}restart_${dateNow}`, text: '🔄 Restart' },
                ],
            }, { quoted: msg });

            // ── Listen for button taps ────────────────────────────────────────
            const handleButton = async (event) => {
                const messageData = event.messages[0];
                if (!messageData?.message) return;

                const selectedId = extractButtonResponseId(messageData);
                if (!selectedId) return;
                if (!selectedId.includes(`_${dateNow}`)) return;
                if (messageData.key?.remoteJid !== chatId) return;

                // Only original sender — silent ignore for everyone else
                const responseSender = getResponseSender(messageData);
                if (responseSender !== originalSender) return;

                // Strip _dateNow + prefix → raw command name
                // e.g. ".ping_1714000000000" → "ping"
                const rawCommand = selectedId
                    .replace(`_${dateNow}`, '')
                    .replace(prefix, '')
                    .trim();

                // Look up command directly from loaded commands map
                const cmd = loadCommands().get(rawCommand);

                if (!cmd) {
                    return await sock.sendMessage(chatId, {
                        text: applyFont(
                            `┏━━『 ERROR 』━━\n\n` +
                            `➥ Reason ➜ Command *${rawCommand}* not found\n\n` +
                            `┗━━━━━━━━━━━━━━━━`
                        ),
                    }, { quoted: messageData });
                }

                try {
                    const extraData = {
                        from:    chatId,
                        sender:  responseSender,
                        isGroup: chatId.endsWith('@g.us'),
                        reply:   (text) => sock.sendMessage(chatId, { text }, { quoted: messageData }),
                        quoted:  messageData,
                    };

                    await cmd.execute(sock, messageData, [], extraData);

                } catch (err) {
                    console.error(`[botstatus] button error (${rawCommand}):`, err.message);
                    await sock.sendMessage(chatId, {
                        text: applyFont(
                            `┏━━『 ERROR 』━━\n\n` +
                            `➥ Command ➜ ${rawCommand}\n` +
                            `➥ Reason  ➜ ${err.message}\n\n` +
                            `┗━━━━━━━━━━━━━━━━`
                        ),
                    }, { quoted: messageData });
                }
            };

            sock.ev.on('messages.upsert', handleButton);

        } catch (error) {
            console.error('[botstatus] error:', error);
            await extra.reply(`❌ Error: ${error.message}`);
        }
    }
};
