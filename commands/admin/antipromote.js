/**
 * AntiPromote Command - Prevent unauthorized admin promotions
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
 * Called from handleGroupUpdate whenever action === 'promote'
 */
async function handlePromote(sock, groupId, actor, promotedJid) {
    try {
        const settings = database.getGroupSettings(groupId);
        if (!settings.antipromote) return;

        // Ignore our own corrective actions
        if (botCorrecting.has(promotedJid)) return;

        const botJid    = sock.user.id.split(':')[0] + '@s.whatsapp.net';
        const actorNum  = actor ? actor.split('@')[0] : 'Unknown';
        const targetNum = promotedJid.split('@')[0];
        const timestamp = new Date().toLocaleString('en-KE', { timeZone: config.timezone || 'Africa/Nairobi' });

        console.log(`[AntiPromote] ${timestamp} | Actor: ${actorNum} | Target: ${targetNum} | Group: ${groupId}`);

        // Verify bot is still admin before acting
        const meta = await sock.groupMetadata(groupId).catch(() => null);
        if (!meta) return;

        const botParticipant = meta.participants.find(p => (p.id || p.jid) === botJid);
        if (!botParticipant || !['admin', 'superadmin'].includes(botParticipant.admin)) {
            console.warn(`[AntiPromote] Bot is not admin in ${groupId} — cannot revert.`);
            return;
        }

        // Mark correction in progress to prevent loop
        markCorrecting(promotedJid);

        // Revert the unauthorized promotion
        await sock.groupParticipantsUpdate(groupId, [promotedJid], 'demote');

        // Send group notification
        await sock.sendMessage(groupId, {
            text: [
                `⚠️ *Security Alert — AntiPromote*`,
                ``,
                `An unauthorized promotion was *blocked and reversed*.`,
                ``,
                `👤 *Initiated by:* @${actorNum}`,
                `🎯 *Target:* @${targetNum}`,
                `⏰ *Time:* ${timestamp}`,
                ``,
                `> Powered by ${config.botName}`
            ].join('\n'),
            mentions: [actor, promotedJid].filter(Boolean)
        });

    } catch (err) {
        console.error('[AntiPromote] Error:', err.message);
    }
}

module.exports = {
    name: 'antipromote',
    aliases: ['antipm'],
    category: 'admin',
    description: 'Prevent unauthorized admin promotions and auto-revert them',
    usage: '.antipromote on | off',
    groupOnly: true,
    adminOnly: true,
    botAdminNeeded: true,

    // Expose handler for index.js / handler.js
    handlePromote,
    botCorrecting,

    async execute(sock, msg, args, extra) {
        const { from, reply, react } = extra;
        const sub = args[0]?.toLowerCase();

        const settings = database.getGroupSettings(from);

        if (!sub) {
            const status = settings.antipromote ? '✅ ON' : '❌ OFF';
            return reply(
                `🛡️ *AntiPromote*\n\n` +
                `Status: *${status}*\n\n` +
                `When enabled, any unauthorized promotion to admin is instantly reversed and logged.\n\n` +
                `Usage:\n` +
                `  .antipromote on\n` +
                `  .antipromote off`
            );
        }

        if (sub === 'on') {
            database.updateGroupSettings(from, { antipromote: true });
            await react('✅');
            return reply(`🛡️ *AntiPromote enabled.*\n\nUnauthorized promotions will be blocked and reversed.`);
        }

        if (sub === 'off') {
            database.updateGroupSettings(from, { antipromote: false });
            await react('✅');
            return reply(`🛡️ *AntiPromote disabled.*`);
        }

        return reply(`❌ Usage: .antipromote on | off`);
    }
};
