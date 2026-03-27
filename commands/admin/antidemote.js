/**
 * AntiDemote Command - Prevent unauthorized admin demotions
 */

const database = require('../../database');
const config   = require('../../config');

// Guard set — tracks JIDs currently being corrected by the bot to prevent loops
const botCorrecting = new Set();

/**
 * Mark a JID as being corrected; auto-clear after 5 seconds
 */
function markCorrecting(jid) {
    botCorrecting.add(jid);
    setTimeout(() => botCorrecting.delete(jid), 5000);
}

/**
 * Called from handleGroupUpdate whenever action === 'demote'
 */
async function handleDemote(sock, groupId, actor, demotedJid) {
    try {
        const settings = database.getGroupSettings(groupId);
        if (!settings.antidemote) return;

        // Ignore our own corrective actions
        if (botCorrecting.has(demotedJid)) return;

        const botJid   = sock.user.id.split(':')[0] + '@s.whatsapp.net';
        const actorNum = actor ? actor.split('@')[0] : 'Unknown';
        const targetNum = demotedJid.split('@')[0];
        const timestamp = new Date().toLocaleString('en-KE', { timeZone: config.timezone || 'Africa/Nairobi' });

        console.log(`[AntiDemote] ${timestamp} | Actor: ${actorNum} | Target: ${targetNum} | Group: ${groupId}`);

        // Verify bot is still admin before acting
        const meta = await sock.groupMetadata(groupId).catch(() => null);
        if (!meta) return;

        const botParticipant = meta.participants.find(p => (p.id || p.jid) === botJid);
        if (!botParticipant || !['admin', 'superadmin'].includes(botParticipant.admin)) {
            console.warn(`[AntiDemote] Bot is not admin in ${groupId} — cannot restore.`);
            return;
        }

        // Mark correction in progress to prevent loop
        markCorrecting(demotedJid);

        // Restore the demoted admin
        await sock.groupParticipantsUpdate(groupId, [demotedJid], 'promote');

        // Send group notification
        await sock.sendMessage(groupId, {
            text: [
                `⚠️ *Security Alert — AntiDemote*`,
                ``,
                `An unauthorized demotion was *blocked and reversed*.`,
                ``,
                `👤 *Initiated by:* @${actorNum}`,
                `🎯 *Target:* @${targetNum}`,
                `⏰ *Time:* ${timestamp}`,
                ``,
                `> Powered by ${config.botName}`
            ].join('\n'),
            mentions: [actor, demotedJid].filter(Boolean)
        });

    } catch (err) {
        console.error('[AntiDemote] Error:', err.message);
    }
}

module.exports = {
    name: 'antidemote',
    aliases: ['antidm'],
    category: 'admin',
    description: 'Prevent unauthorized admin demotions and auto-restore victims',
    usage: '.antidemote on | off',
    groupOnly: true,
    adminOnly: true,
    botAdminNeeded: true,

    // Expose handler for index.js / handler.js
    handleDemote,
    botCorrecting,

    async execute(sock, msg, args, extra) {
        const { from, reply, react } = extra;
        const sub = args[0]?.toLowerCase();

        const settings = database.getGroupSettings(from);

        if (!sub) {
            const status = settings.antidemote ? '✅ ON' : '❌ OFF';
            return reply(
                `🛡️ *AntiDemote*\n\n` +
                `Status: *${status}*\n\n` +
                `When enabled, any attempt to demote an admin is instantly reversed and logged.\n\n` +
                `Usage:\n` +
                `  .antidemote on\n` +
                `  .antidemote off`
            );
        }

        if (sub === 'on') {
            database.updateGroupSettings(from, { antidemote: true });
            await react('✅');
            return reply(`🛡️ *AntiDemote enabled.*\n\nUnauthorized demotions will be blocked and reversed.`);
        }

        if (sub === 'off') {
            database.updateGroupSettings(from, { antidemote: false });
            await react('✅');
            return reply(`🛡️ *AntiDemote disabled.*`);
        }

        return reply(`❌ Usage: .antidemote on | off`);
    }
};
