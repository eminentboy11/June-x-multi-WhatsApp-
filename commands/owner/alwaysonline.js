/**
 * Always Online — keeps bot presence set to "available" continuously
 * Setting persisted in database/bot-settings.json via database.js
 */
const db = require('../../database');

const HEARTBEAT_MS = 10_000; // ping presence every 10 s

let _interval = null;

function loadSettings() {
    return { enabled: db.getBotSetting('alwaysOnline') || false };
}

function saveSettings(s) {
    db.setBotSetting('alwaysOnline', !!s.enabled);
}

function startHeartbeat(sock) {
    if (_interval) clearInterval(_interval);
    sock.sendPresenceUpdate('available').catch(() => {});
    _interval = setInterval(() => {
        sock.sendPresenceUpdate('available').catch(() => {});
    }, HEARTBEAT_MS);
}

function stopHeartbeat(sock) {
    if (_interval) { clearInterval(_interval); _interval = null; }
    if (sock) sock.sendPresenceUpdate('unavailable').catch(() => {});
}

module.exports = {
    name: 'alwaysonline',
    aliases: ['aol', 'onlinealways'],
    category: 'owner',
    ownerOnly: true,
    description: 'Keep bot presence always online',
    usage: '.alwaysonline on | off',

    loadSettings,
    startHeartbeat,
    stopHeartbeat,

    async execute(sock, msg, args, extra) {
        try {
            const settings = loadSettings();
            const opt = args[0]?.toLowerCase();

            if (!opt) {
                return extra.reply(
                    `🟢 *Always Online*\n\n` +
                    `📌 Status: *${settings.enabled ? 'ON ✅' : 'OFF ❌'}*\n\n` +
                    `*Commands:*\n` +
                    `  .alwaysonline on\n` +
                    `  .alwaysonline off`
                );
            }

            if (opt === 'on') {
                saveSettings({ enabled: true });
                startHeartbeat(sock);
                return extra.reply(
                    `🟢 *Always Online: ON*\n\n` +
                    `Bot will now continuously appear online to everyone.`
                );
            }

            if (opt === 'off') {
                saveSettings({ enabled: false });
                stopHeartbeat(sock);
                return extra.reply(
                    `⚫ *Always Online: OFF*\n\n` +
                    `Bot presence is now normal (goes offline when idle).`
                );
            }

            return extra.reply('⚠️ Use: .alwaysonline on  or  .alwaysonline off');

        } catch (err) {
            await extra.reply(`❌ Error: ${err.message}`);
        }
    }
};
