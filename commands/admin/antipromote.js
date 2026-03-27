/**
 * AntiPromote Command - Prevent unauthorized admin promotions
 */

const database        = require('../../database');
const config          = require('../../config');
const { findParticipant } = require('../../utils/jidHelper');

// Guard — tracks JIDs currently being corrected by the bot to prevent echo loops
const botCorrecting = new Set();

function markCorrecting(jid) {
    botCorrecting.add(jid);
    setTimeout(() => botCorrecting.delete(jid), 6000);
}

/**
 * Called from handler.js handleGroupUpdate when action === 'promote'
 */
async function handlePromote(sock, groupId, actor, promotedJid) {
    try {
        const settings = database.getGroupSettings(groupId);
        if (!settings.antipromote) return;

        // Skip if this is the bot's own corrective action echoing back
        if (botCorrecting.has(promotedJid)) return;

        // Fetch fresh metadata and resolve actual participant id (LID-aware)
        const meta = await sock.groupMetadata(groupId).catch(() => null);
        if (!meta) return;

        const found = findParticipant(meta.participants, promotedJid);
        if (!found) return;

        const resolvedJid = found.id;     // real JID as stored in group metadata
        const actorNum    = actor ? actor.split('@')[0] : 'Unknown';
        const targetNum   = resolvedJid.split('@')[0];
        const timestamp   = new Date().toLocaleString();

        // Mark BOTH JID variants before demoting to block the echo
        markCorrecting(resolvedJid);
        markCorrecting(promotedJid);

        // Revert the unauthorized promotion using the resolved participant id
        await sock.groupParticipantsUpdate(groupId, [resolvedJid], 'demote');

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
            mentions: [actor, resolvedJid].filter(Boolean)
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
        const sub      = args[0]?.toLowerCase();
        const settings = database.getGroupSettings(from);

        if (!sub) {
            return reply(
                `🛡️ *AntiPromote*\n\n` +
                `Status: *${settings.antipromote ? '✅ ON' : '❌ OFF'}*\n\n` +
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
