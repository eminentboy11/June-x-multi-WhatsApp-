/**
 * AntiPromote Command - Prevent unauthorized admin promotions
 */

const database = require('../../database');
const config   = require('../../config');

// Guard set — tracks JIDs being corrected by the bot to prevent infinite loops
const botCorrecting = new Set();

function markCorrecting(jid) {
    botCorrecting.add(jid);
    setTimeout(() => botCorrecting.delete(jid), 6000);
}

/**
 * Called from handler.js handleGroupUpdate on action === 'promote'
 */
async function handlePromote(sock, groupId, actor, promotedJid) {
    try {
        const settings = database.getGroupSettings(groupId);
        if (!settings.antipromote) return;

        // Skip if this is our own corrective action
        if (botCorrecting.has(promotedJid)) return;

        const actorNum  = actor       ? actor.split('@')[0]       : 'Unknown';
        const targetNum = promotedJid ? promotedJid.split('@')[0] : 'Unknown';
        const timestamp = new Date().toLocaleString();

        console.log(`[AntiPromote] BLOCKED | Actor: ${actorNum} → Target: ${targetNum} | Group: ${groupId} | ${timestamp}`);

        // Mark as correcting BEFORE sending demote to block the echo
        markCorrecting(promotedJid);

        // Revert the unauthorized promotion
        await sock.groupParticipantsUpdate(groupId, [promotedJid], 'demote');

        // Notify group
        await sock.sendMessage(groupId, {
            text: [
                `⚠️ *Security Alert — AntiPromote*`,
                ``,
                `An unauthorized promotion was *blocked and reversed*.`,
                ``,
                `👤 *By:* @${actorNum}`,
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
    description: 'Block and reverse unauthorized admin promotions',
    usage: '.antipromote on | off',
    groupOnly: true,
    adminOnly: true,
    botAdminNeeded: true,

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
                `When ON, any unauthorized promotion to admin is instantly reversed.\n\n` +
                `• .antipromote on\n• .antipromote off`
            );
        }
        if (sub === 'on') {
            database.updateGroupSettings(from, { antipromote: true });
            await react('✅');
            return reply(`🛡️ *AntiPromote enabled.* Unauthorized promotions will be reversed.`);
        }
        if (sub === 'off') {
            database.updateGroupSettings(from, { antipromote: false });
            await react('✅');
            return reply(`🛡️ *AntiPromote disabled.*`);
        }
        return reply(`❌ Usage: .antipromote on | off`);
    }
};
