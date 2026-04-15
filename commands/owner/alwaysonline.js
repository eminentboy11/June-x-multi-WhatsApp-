/**
 * Always Online — keeps bot presence set to "available" continuously
 * Setting persisted in data/alwaysonline.json
 */

const fs   = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, '../../data/alwaysonline.json');
const HEARTBEAT_MS  = 10_000; // ping presence every 10 s

let _interval = null;

function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
        }
    } catch (_) {}
    return { enabled: false };
}

function saveSettings(s) {
    const dir = path.dirname(SETTINGS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2));
}

function startHeartbeat(sock) {
    if (_interval) clearInterval(_interval);
    // Send immediately then repeat
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
                settings.enabled = true;
                saveSettings(settings);
                startHeartbeat(sock);
                return extra.reply(
                    `🟢 *Always Online: ON*\n\n` +
                    `Bot will now continuously appear online to everyone.`
                );
            }

            if (opt === 'off') {
                settings.enabled = false;
                saveSettings(settings);
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
