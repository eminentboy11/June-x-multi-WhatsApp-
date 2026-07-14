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
 * Check if a message is forwarded.
 * Baileys marks forwarded messages in two ways:
 *   1. contextInfo.forwardingScore > 0
 *   2. contextInfo.isForwarded === true
 * Both are checked so no forwarded message slips through.
 */
function isForwarded(msg) {
    if (!msg.message) return false;

    const msgObj = msg.message;
    for (const key of Object.keys(msgObj)) {
        const ctx = msgObj[key]?.contextInfo;
        if (!ctx) continue;
        if (ctx.isForwarded === true) return true;
        if (typeof ctx.forwardingScore === 'number' && ctx.forwardingScore > 0) return true;
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
        const senderParticipant = participants.find(
            p => p.id === sender || p.id?.split(':')[0] === sender.split(':')[0]
        );
        const senderIsAdmin = !!senderParticipant?.admin;
        const botIsAdmin = !!participants.find(
            p => (p.id === sock.user?.id || p.id?.split(':')[0] === sock.user?.id?.split(':')[0]) && p.admin
        );
        const isBot = sender === sock.user?.id || sender.split(':')[0] === sock.user?.id?.split(':')[0];

        // Admins, owners and the bot itself are exempt
        if (senderIsAdmin || isBot) return false;

        // Bot needs admin to take any meaningful action
        if (!botIsAdmin) return false;

        const action = settings.antiforwardAction || 'delete';
        const maxWarnings = settings.antiforwardMaxWarnings || 3;
        const senderNum = sender.split('@')[0];

        // Always delete the forwarded message first
        try { await sock.sendMessage(from, { delete: msg.key }); } catch (_) {}

        // ─── WARN ───
        if (action === 'warn') {
            const warnings = database.addAntiforwardWarning(from, sender);

            if (warnings >= maxWarnings) {
                try {
                    await sock.groupParticipantsUpdate(from, [sender], 'remove');
                    await sock.sendMessage(from, {
                        text: `🚫 *AntiForward* — @${senderNum} was *removed*.\nReached max warnings (${maxWarnings}/${maxWarnings}) for forwarding messages.`,
                        mentions: [sender]
                    });
                    database.clearAllAntiforwardWarnings(from, sender);
                } catch (e) {
                    console.error('[antiforward]', e.message);
                }
                return true;
            }

            try {
                await sock.sendMessage(from, {
                    text: `↩️ *AntiForward* ⚠️ Warning to @${senderNum}\nForwarded message deleted. Warnings: *${warnings}/${maxWarnings}*`,
                    mentions: [sender]
                });
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
                    text: `🚫 *AntiForward* — @${senderNum} was *removed* for forwarding messages.`,
                    mentions: [sender]
                });
            } catch (e) {
                console.error('[antiforward]', e.message);
            }
            return true;
        }

        // ─── DELETE (default) ───
        // Message already deleted above — just notify
        try {
            await sock.sendMessage(from, {
                text: `↩️ *AntiForward* — @${senderNum}'s forwarded message was deleted.`,
                mentions: [sender]
            });
        } catch (e) {
            console.error('[antiforward]', e.message);
        }
        return true;
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
