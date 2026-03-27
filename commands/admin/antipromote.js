/**
 * AntiPromote Command - Prevent unauthorized admin promotions
 */

const database = require('../../database');
const config   = require('../../config');

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

        const actorNum  = actor       ? actor.split('@')[0]       : 'Unknown';
        const targetNum = promotedJid ? promotedJid.split('@')[0] : 'Unknown';
        const timestamp = new Date().toLocaleString();

        // Guard before acting to block the echo event
        markCorrecting(promotedJid);

        // Revert the unauthorized promotion — pass pJid directly (same as .demote command)
        await sock.groupParticipantsUpdate(groupId, [promotedJid], 'demote');

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
