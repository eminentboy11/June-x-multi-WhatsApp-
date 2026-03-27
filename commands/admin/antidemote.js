/**
 * AntiDemote Command - Prevent unauthorized admin demotions
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
 * Called from handler.js handleGroupUpdate when action === 'demote'
 */
async function handleDemote(sock, groupId, actor, demotedJid) {
    try {
        const settings = database.getGroupSettings(groupId);
        if (!settings.antidemote) return;

        // Skip if this is the bot's own corrective action echoing back
        if (botCorrecting.has(demotedJid)) return;

        // Fetch fresh metadata and resolve actual participant id (LID-aware)
        const meta = await sock.groupMetadata(groupId).catch(() => null);
        if (!meta) return;

        const found = findParticipant(meta.participants, demotedJid);
        if (!found) return;

        const resolvedJid = found.id;     // real JID as stored in group metadata
        const actorNum    = actor ? actor.split('@')[0] : 'Unknown';
        const targetNum   = resolvedJid.split('@')[0];
        const timestamp   = new Date().toLocaleString();

        // Mark BOTH JID variants before promoting to block the echo
        markCorrecting(resolvedJid);
        markCorrecting(demotedJid);

        // Restore the demoted admin using the resolved participant id
        await sock.groupParticipantsUpdate(groupId, [resolvedJid], 'promote');

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
            mentions: [actor, resolvedJid].filter(Boolean)
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
        const sub      = args[0]?.toLowerCase();
        const settings = database.getGroupSettings(from);

        if (!sub) {
            return reply(
                `🛡️ *AntiDemote*\n\n` +
                `Status: *${settings.antidemote ? '✅ ON' : '❌ OFF'}*\n\n` +
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
