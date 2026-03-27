/**
 * AntiDemote Command - Prevent unauthorized admin demotions
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
 * Called from handler.js handleGroupUpdate on action === 'demote'
 */
async function handleDemote(sock, groupId, actor, demotedJid) {
    try {
        const settings = database.getGroupSettings(groupId);
        if (!settings.antidemote) return;

        // Skip if this is our own corrective action
        if (botCorrecting.has(demotedJid)) return;

        const actorNum  = actor  ? actor.split('@')[0]       : 'Unknown';
        const targetNum = demotedJid ? demotedJid.split('@')[0] : 'Unknown';
        const timestamp = new Date().toLocaleString();

        console.log(`[AntiDemote] BLOCKED | Actor: ${actorNum} → Target: ${targetNum} | Group: ${groupId} | ${timestamp}`);

        // Mark as correcting BEFORE sending promote to block the echo
        markCorrecting(demotedJid);

        // Restore the demoted admin
        await sock.groupParticipantsUpdate(groupId, [demotedJid], 'promote');

        // Notify group
        await sock.sendMessage(groupId, {
            text: [
                `⚠️ *Security Alert — AntiDemote*`,
                ``,
                `An unauthorized demotion was *blocked and reversed*.`,
                ``,
                `👤 *By:* @${actorNum}`,
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
    description: 'Block and reverse unauthorized admin demotions',
    usage: '.antidemote on | off',
    groupOnly: true,
    adminOnly: true,
    botAdminNeeded: true,

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
                `When ON, any demotion of an admin is instantly reversed.\n\n` +
                `• .antidemote on\n• .antidemote off`
            );
        }
        if (sub === 'on') {
            database.updateGroupSettings(from, { antidemote: true });
            await react('✅');
            return reply(`🛡️ *AntiDemote enabled.* Unauthorized demotions will be reversed.`);
        }
        if (sub === 'off') {
            database.updateGroupSettings(from, { antidemote: false });
            await react('✅');
            return reply(`🛡️ *AntiDemote disabled.*`);
        }
        return reply(`❌ Usage: .antidemote on | off`);
    }
};
