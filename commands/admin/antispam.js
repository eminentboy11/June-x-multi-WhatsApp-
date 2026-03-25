const database = require('../../database');

// In-memory tracker: { groupId: { userId: [timestamps] } }
const spamTracker = new Map();

const DEFAULT_LIMIT   = 5;  // messages
const DEFAULT_WINDOW  = 5;  // seconds

function getTracker(groupId, userId) {
    if (!spamTracker.has(groupId)) spamTracker.set(groupId, new Map());
    const group = spamTracker.get(groupId);
    if (!group.has(userId)) group.set(userId, []);
    return group.get(userId);
}

function pruneOld(timestamps, windowMs) {
    const cutoff = Date.now() - windowMs;
    while (timestamps.length && timestamps[0] < cutoff) timestamps.shift();
}

/**
 * Called for every group message — returns true if action was taken.
 */
async function handleAntispam(sock, msg, groupMetadata) {
    try {
        if (!msg?.key || !msg.message) return false;
        const from   = msg.key.remoteJid;
        if (!from.endsWith('@g.us')) return false;

        const gs = database.getGroupSettings(from);
        if (!gs.antiSpam) return false;

        const sender = msg.key.participant || msg.key.remoteJid;
        if (!sender) return false;

        // Admins and bot owner are immune
        const admins = (groupMetadata?.participants || [])
            .filter(p => p.admin)
            .map(p => p.id);
        if (admins.includes(sender)) return false;

        const limit  = gs.antiSpamLimit  || DEFAULT_LIMIT;
        const window = gs.antiSpamWindow || DEFAULT_WINDOW;
        const action = gs.antiSpamAction || 'delete';
        const windowMs = window * 1000;

        const timestamps = getTracker(from, sender);
        pruneOld(timestamps, windowMs);
        timestamps.push(Date.now());

        if (timestamps.length < limit) return false;

        // Threshold exceeded — clear their record & act
        spamTracker.get(from).delete(sender);

        const senderNum  = sender.split('@')[0].split(':')[0];
        const senderTag  = `@${senderNum}`;
        const isBotAdmin = (groupMetadata?.participants || [])
            .some(p => p.id === sock.user?.id && p.admin);

        if (action === 'delete' || action === 'warn') {
            try { await sock.sendMessage(from, { delete: msg.key }); } catch (_) {}
            await sock.sendMessage(from, {
                text: `⚠️ *Anti-Spam* — ${senderTag} please slow down!\n_${limit} messages in ${window}s detected._`,
                mentions: [sender]
            });
        }

        if (action === 'kick' && isBotAdmin) {
            await sock.sendMessage(from, {
                text: `🚫 *Anti-Spam* — ${senderTag} has been removed for spamming.`,
                mentions: [sender]
            });
            await sock.groupParticipantsUpdate(from, [sender], 'remove');
        }

        if (action === 'mute' && isBotAdmin) {
            // Mute by removing then re-adding is not standard; warn instead
            await sock.sendMessage(from, {
                text: `🔇 *Anti-Spam* — ${senderTag} slow down or you will be removed!`,
                mentions: [sender]
            });
        }

        return true;
    } catch (e) {
        console.error('[ANTISPAM] error:', e.message);
        return false;
    }
}

module.exports = {
    name: 'antispam',
    aliases: ['spamprotect', 'nospam'],
    category: 'admin',
    description: 'Prevent spam in groups — warns, deletes, or kicks spammers',
    usage: '.antispam on/off/set/action',
    groupOnly: true,
    adminOnly: true,

    handleAntispam,

    async execute(sock, msg, args, extra) {
        const { from, reply } = extra;
        const gs  = database.getGroupSettings(from);
        const sub = (args[0] || '').toLowerCase();

        if (!sub) {
            const limit  = gs.antiSpamLimit  || DEFAULT_LIMIT;
            const window = gs.antiSpamWindow || DEFAULT_WINDOW;
            const action = gs.antiSpamAction || 'delete';
            return reply(
                `🛡️ *Anti-Spam Settings*\n` +
                `━━━━━━━━━━━━━━━\n` +
                `📌 Status: *${gs.antiSpam ? '✅ ON' : '❌ OFF'}*\n` +
                `📊 Limit: *${limit} msgs / ${window}s*\n` +
                `⚡ Action: *${action}*\n\n` +
                `*Commands:*\n` +
                `  .antispam on\n` +
                `  .antispam off\n` +
                `  .antispam set <count> <seconds>  _(e.g. set 5 10)_\n` +
                `  .antispam action delete|warn|kick|mute`
            );
        }

        if (sub === 'on') {
            database.updateGroupSettings(from, { antiSpam: true });
            return reply('✅ *Anti-Spam* enabled.');
        }

        if (sub === 'off') {
            database.updateGroupSettings(from, { antiSpam: false });
            return reply('❌ *Anti-Spam* disabled.');
        }

        if (sub === 'set') {
            const count  = parseInt(args[1]);
            const window = parseInt(args[2]);
            if (!count || !window || count < 2 || window < 1) {
                return reply('⚠️ Usage: .antispam set <count> <seconds>\nExample: .antispam set 5 10');
            }
            database.updateGroupSettings(from, { antiSpamLimit: count, antiSpamWindow: window });
            return reply(`✅ Spam threshold set to *${count} messages in ${window} seconds*.`);
        }

        if (sub === 'action') {
            const act = (args[1] || '').toLowerCase();
            if (!['delete', 'warn', 'kick', 'mute'].includes(act)) {
                return reply('⚠️ Valid actions: delete | warn | kick | mute');
            }
            database.updateGroupSettings(from, { antiSpamAction: act });
            return reply(`✅ Spam action set to *${act}*.`);
        }

        return reply('⚠️ Unknown option. Use .antispam for help.');
    }
};
