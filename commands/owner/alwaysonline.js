/**
 * Always Online — keeps bot presence set to "available" continuously
 * Setting persisted in database/bot-settings.json via database.js
 */
const db = require('../../database');

const HEARTBEAT_MS = 10_000; // ping presence every 10 s

// Per-bot heartbeat intervals (multi-session: each connected account keeps
// its own presence loop).
const _intervals = new Map();
function _botKey(sock) {
  return String(sock?.user?.id || sock?.authState?.creds?.me?.id || 'default');
}

function loadSettings() {
    return { enabled: db.getBotSetting('alwaysOnline') || false };
}

function saveSettings(s) {
    db.setBotSetting('alwaysOnline', !!s.enabled);
}

function startHeartbeat(sock) {
    const key = _botKey(sock);
    const previous = _intervals.get(key);
    if (previous) clearInterval(previous);
    sock.sendPresenceUpdate('available').catch(() => {});
    _intervals.set(key, setInterval(() => {
        sock.sendPresenceUpdate('available').catch(() => {});
    }, HEARTBEAT_MS));
}

function stopHeartbeat(sock) {
    const key = _botKey(sock);
    const interval = _intervals.get(key);
    if (interval) { clearInterval(interval); _intervals.delete(key); }
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
