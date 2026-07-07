/**
 * AntiForward Command
 * Detects and handles forwarded messages in groups.
 * Prevents non-admins from forwarding messages.
 *
 * Usage:
 *   .antiforward                    — show status
 *   .antiforward on                 — enable antiforward (default action: delete)
 *   .antiforward off                — disable antiforward
 *   .antiforward action <action>    — set action (delete|warn|kick)
 *   .antiforward warns <number>     — set max warnings before kick (default: 3)
 */

const database = require(require('path').join(global.__CORE__, 'database'));

/**
 * Check if a message is forwarded
 * Forwarded messages have contextInfo with forwardingScore > 0
 */
function isForwarded(msg) {
    if (!msg.message) return false;

    const ext = msg.message.extendedTextMessage;
    if (ext?.contextInfo?.forwardingScore && ext.contextInfo.forwardingScore > 0) {
        return true;
    }

    const msgObj = msg.message;
    for (const key in msgObj) {
        const obj = msgObj[key];
        if (obj?.contextInfo?.forwardingScore && obj.contextInfo.forwardingScore > 0) {
            return true;
        }
    }

    return false;
}

/**
 * Handle antiforward enforcement
 */
async function handleAntiforward(sock, msg, groupMetadata) {
    try {
        if (!msg?.key || !msg.message) return false;
        const from = msg.key.remoteJid;
        if (!from.endsWith('@g.us')) return false;

        const settings = database.getAntiforwardSettings(from);
        if (!settings.antiforward) return false;
        if (!isForwarded(msg)) return false;

        const sender = msg.key.participant || msg.key.remoteJid;
        if (!sender) return false;

        const participants = groupMetadata?.participants || [];
        const senderParticipant = participants.find(p => p.id === sender);
        const isAdmin = senderParticipant?.admin;
        const isBot = sender === sock.user?.id;

        if (isAdmin || isBot) return false;

        const action = settings.antiforwardAction;
        const maxWarnings = settings.antiforwardMaxWarnings;
        const senderNum = sender.split('@')[0];

        // ─── WARN ───
        if (action === 'warn') {
            const warnings = database.addAntiforwardWarning(from, sender);

            if (warnings >= maxWarnings) {
                try {
                    await sock.groupParticipantsUpdate(from, [sender], 'remove');
                    await sock.sendMessage(from, {
                        text: `🚫 @${senderNum} kicked (max warnings)`,
                        mentions: [sender]
                    });
                } catch (e) {
                    console.error('[antiforward]', e.message);
                }
                database.clearAllAntiforwardWarnings(from, sender);
                return true;
            }

            try {
                await sock.sendMessage(from, {
                    text: `⚠️ @${senderNum} ${warnings}/${maxWarnings}`,
                    mentions: [sender]
                });
            } catch (e) {
                console.error('[antiforward]', e.message);
            }
            return true;
        }

        // ─── DELETE (default) ───
        if (action === 'delete') {
            try {
                await sock.sendMessage(from, { delete: msg.key });
            } catch (e) {
                console.error('[antiforward]', e.message);
            }
            return true;
        }

        // ─── KICK ───
        if (action === 'kick') {
            try {
                await sock.groupParticipantsUpdate(from, [sender], 'remove');
                await sock.sendMessage(from, {
                    text: `🚫 @${senderNum} kicked`,
                    mentions: [sender]
                });
            } catch (e) {
                console.error('[antiforward]', e.message);
            }
            return true;
        }

        return false;
    } catch (e) {
        console.error('[antiforward]', e.message);
        return false;
    }
}

module.exports = {
    name: 'antiforward',
    aliases: ['noforward', 'antiforw', 'forwardprotect'],
    category: 'admin',
    description: 'Prevent non-admins from forwarding messages in the group',
    usage: '.antiforward on/off/action/warns',
    groupOnly: true,
    adminOnly: true,

    handleAntiforward,

    async execute(sock, msg, args, extra) {
        try {
            const { from, reply, react } = extra;
            const sub = (args[0] || '').toLowerCase();
            const settings = database.getAntiforwardSettings(from);

            // ─── Status (no args) ───
            if (!sub) {
                return reply(
                    `AntiForward: ${settings.antiforward ? 'ON' : 'OFF'} (${settings.antiforwardAction}, ${settings.antiforwardMaxWarnings} warns)\n` +
                    `.antiforward on/off/action <delete|warn|kick>/warns <n>`
                );
            }

            // ─── ON ───
            if (sub === 'on') {
                if (settings.antiforward) return react('❌');
                database.updateAntiforwardSettings(from, true, 'delete', settings.antiforwardMaxWarnings);
                return react('✅');
            }

            // ─── OFF ───
            if (sub === 'off') {
                if (!settings.antiforward) return react('❌');
                database.updateAntiforwardSettings(from, false, settings.antiforwardAction, settings.antiforwardMaxWarnings);
                return react('✅');
            }

            // ─── action ───
            if (sub === 'action') {
                const newAction = (args[1] || '').toLowerCase();
                if (!['delete', 'warn', 'kick'].includes(newAction)) return react('❌');
                database.updateAntiforwardSettings(from, settings.antiforward, newAction, settings.antiforwardMaxWarnings);
                return react('✅');
            }

            // ─── warns ───
            if (sub === 'warns' || sub === 'warnings') {
                const num = parseInt(args[1], 10);
                if (isNaN(num) || num < 1) return react('❌');
                database.updateAntiforwardSettings(from, settings.antiforward, settings.antiforwardAction, num);
                return react('✅');
            }

            return react('❌');
        } catch (e) {
            console.error('[antiforward]', e.message);
            return extra.react('❌');
        }
    }
};
