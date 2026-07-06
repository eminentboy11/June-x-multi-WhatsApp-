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
    
    // Check extendedTextMessage
    const ext = msg.message.extendedTextMessage;
    if (ext?.contextInfo?.forwardingScore && ext.contextInfo.forwardingScore > 0) {
        return true;
    }
    
    // Check all message types for forward flag
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
        
        // Antiforward disabled
        if (!settings.antiforward) return false;

        // Check if message is forwarded
        if (!isForwarded(msg)) return false;

        const sender = msg.key.participant || msg.key.remoteJid;
        if (!sender) return false;

        // Get group metadata
        const participants = groupMetadata?.participants || [];
        const senderParticipant = participants.find(p => p.id === sender);
        const isAdmin = senderParticipant?.admin;
        const isBot = sender === sock.user?.id;

        // Admins and bot are immune
        if (isAdmin || isBot) return false;

        const action = settings.antiforwardAction;
        const maxWarnings = settings.antiforwardMaxWarnings;
        const senderNum = sender.split('@')[0];

        // ─── Handle WARN action ────────────────────────────────────────────
        if (action === 'warn') {
            const warnings = database.addAntiforwardWarning(from, sender);
            
            if (warnings >= maxWarnings) {
                // Reached max warnings — kick
                try {
                    await sock.groupParticipantsUpdate(from, [sender], 'remove');
                    await sock.sendMessage(from, {
                        text: `🚫 *AntiForward* — *@${senderNum}* reached max warnings (${maxWarnings}) and was kicked!`,
                        mentions: [sender]
                    });
                } catch (e) {
                    console.error('[ANTIFORWARD] Error kicking user:', e.message);
                }
                database.clearAllAntiforwardWarnings(from, sender);
                return true;
            }

            // Send warning
            try {
                await sock.sendMessage(from, {
                    text: `⚠️ *AntiForward Warning* — *@${senderNum}*, forwarded messages are not allowed!\n⚠️ Warnings: *${warnings}/${maxWarnings}*`,
                    mentions: [sender]
                });
            } catch (e) {
                console.error('[ANTIFORWARD] Error sending warning:', e.message);
            }
            return true;
        }

        // ─── Handle DELETE action (default) ─────────────────────────────────
        if (action === 'delete') {
            try {
                await sock.sendMessage(from, { delete: msg.key });
                await sock.sendMessage(from, {
                    text: `🗑️ *AntiForward* — *@${senderNum}* forwarded message deleted!`,
                    mentions: [sender]
                });
            } catch (e) {
                console.error('[ANTIFORWARD] Error deleting message:', e.message);
            }
            return true;
        }

        // ─── Handle KICK action ────────────────────────────────────────────
        if (action === 'kick') {
            try {
                await sock.groupParticipantsUpdate(from, [sender], 'remove');
                await sock.sendMessage(from, {
                    text: `🚫 *AntiForward* — *@${senderNum}* was kicked for forwarding!`,
                    mentions: [sender]
                });
            } catch (e) {
                console.error('[ANTIFORWARD] Error kicking user:', e.message);
            }
            return true;
        }

        return false;
    } catch (e) {
        console.error('[ANTIFORWARD] Error in handleAntiforward:', e.message);
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

            // ─── Show status (no args) ──────────────────────────────────────
            if (!sub) {
                const status = settings.antiforward ? '✅ ON' : '❌ OFF';
                const action = settings.antiforwardAction;
                const maxWarns = settings.antiforwardMaxWarnings;

                return reply(
                    `🚫 *AntiForward Settings*\n\n` +
                    `📌 Status: *${status}*\n` +
                    `⚡ Action: *${action}*\n` +
                    `⚠️ Max Warnings: *${maxWarns}*\n\n` +
                    `*Commands:*\n` +
                    `• \`.antiforward on\` — Enable (default: delete)\n` +
                    `• \`.antiforward off\` — Disable\n` +
                    `• \`.antiforward action delete\` — Delete forwarded msgs\n` +
                    `• \`.antiforward action warn\` — Warn → kick\n` +
                    `• \`.antiforward action kick\` — Kick immediately\n` +
                    `• \`.antiforward warns 5\` — Set max warnings`
                );
            }

            // ─── Turn ON ────────────────────────────────────────────────────
            if (sub === 'on') {
                if (settings.antiforward) {
                    return reply('❌ AntiForward is already *ON*.');
                }
                database.updateAntiforwardSettings(from, true, 'delete', settings.antiforwardMaxWarnings);
                await react('✅');
                return reply(
                    `✅ *AntiForward* turned *ON*\n` +
                    `Action: *delete* (default)\n` +
                    `Non-admins cannot forward messages now.`
                );
            }

            // ─── Turn OFF ───────────────────────────────────────────────────
            if (sub === 'off') {
                if (!settings.antiforward) {
                    return reply('❌ AntiForward is already *OFF*.');
                }
                database.updateAntiforwardSettings(from, false, settings.antiforwardAction, settings.antiforwardMaxWarnings);
                await react('❌');
                return reply('❌ *AntiForward* turned *OFF*.');
            }

            // ─── Set action ────────────────────────────────────────────────
            if (sub === 'action') {
                const newAction = (args[1] || '').toLowerCase();
                if (!['delete', 'warn', 'kick'].includes(newAction)) {
                    return reply(
                        `❌ Invalid action. Use one of:\n` +
                        `• \`delete\` — Delete forwarded messages (default)\n` +
                        `• \`warn\` — Warn then kick after max warnings\n` +
                        `• \`kick\` — Kick immediately`
                    );
                }
                database.updateAntiforwardSettings(from, settings.antiforward, newAction, settings.antiforwardMaxWarnings);
                await react('✅');
                return reply(`✅ AntiForward action set to *${newAction}*.`);
            }

            // ─── Set max warnings ───────────────────────────────────────────
            if (sub === 'warns' || sub === 'warnings') {
                const num = parseInt(args[1], 10);
                if (isNaN(num) || num < 1) {
                    return reply('❌ Please provide a valid number (minimum: 1).');
                }
                database.updateAntiforwardSettings(from, settings.antiforward, settings.antiforwardAction, num);
                await react('✅');
                return reply(`✅ Max warnings set to *${num}*.`);
            }

            return reply(
                `❌ Unknown option.\n\n` +
                `Use: \`.antiforward on | off | action <action> | warns <number>\``
            );
        } catch (e) {
            console.error('[ANTIFORWARD] Error in execute:', e.message);
            return extra.reply('❌ Error executing antiforward command.');
        }
    }
};
