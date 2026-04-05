/**
 * AntiDemote Command - Prevent unauthorized admin demotions
 *
 * Actions (applied to BOTH demoter and demoted member):
 *   revert  — re-promote the demoted admin (default)
 *   kick    — kick both the demoter and the demoted member
 *   demote  — demote the demoter (victim stays demoted)
 */

const database = require('../../database');
const config   = require('../../config');

// Guard — prevents echo loop when the bot itself makes changes
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

        // Skip bot's own corrective actions
        if (botCorrecting.has(demotedJid)) return;

        const action    = settings.antidemoteAction || 'revert';
        const actorNum  = actor       ? actor.split('@')[0]       : 'Unknown';
        const targetNum = demotedJid  ? demotedJid.split('@')[0]  : 'Unknown';
        const timestamp = new Date().toLocaleString('en-GB', {
            timeZone: config.timezone || 'Africa/Nairobi',
            hour12: false, day: '2-digit', month: '2-digit',
            year: 'numeric', hour: '2-digit', minute: '2-digit'
        });

        markCorrecting(demotedJid);
        if (actor) markCorrecting(actor);

        let actionLine = '';

        if (action === 'revert') {
            // Re-promote the demoted admin
            await sock.groupParticipantsUpdate(groupId, [demotedJid], 'promote');
            actionLine = `🔄 *Action:* Demotion reversed — admin restored`;

        } else if (action === 'kick') {
            // Kick both the demoter AND the demoted member
            const toKick = [demotedJid, actor].filter(Boolean);
            await sock.groupParticipantsUpdate(groupId, toKick, 'remove');
            actionLine = `🚫 *Action:* Both parties kicked from the group`;

        } else if (action === 'demote') {
            // Demote the demoter (actor) — victim is already demoted
            if (actor) await sock.groupParticipantsUpdate(groupId, [actor], 'demote');
            actionLine = `⬇️ *Action:* Demoter demoted to regular member`;
        }

        await sock.sendMessage(groupId, {
            text: [
                `⚠️ *Security Alert — AntiDemote*`,
                ``,
                `An unauthorized demotion was *detected and actioned*.`,
                ``,
                `👤 *Demoter:* @${actorNum}`,
                `🎯 *Demoted:* @${targetNum}`,
                `⏰ *Time:* ${timestamp}`,
                `${actionLine}`,
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
    description: 'Block unauthorized admin demotions with configurable action',
    usage: '.antidemote on | revert | kick | demote | off',
    groupOnly: true,
    adminOnly: true,
    botAdminNeeded: true,

    handleDemote,
    botCorrecting,

    async execute(sock, msg, args, extra) {
        const { from, reply, react } = extra;
        const sub      = args[0]?.toLowerCase();
        const settings = database.getGroupSettings(from);
        const enabled  = !!settings.antidemote;
        const action   = settings.antidemoteAction || 'revert';

        const actionLabel = {
            revert: '🔄 Revert — restore the demoted admin',
            kick:   '🚫 Kick — remove both parties from group',
            demote: '⬇️ Demote — demote the demoter'
        };

        if (!sub) {
            return reply(
                `🛡️ *AntiDemote*\n\n` +
                `Status: *${enabled ? '✅ ON' : '❌ OFF'}*\n` +
                `Action: *${enabled ? (actionLabel[action] || action) : '—'}*\n\n` +
                `Catches unauthorized demotions and acts on both parties.\n\n` +
                `*Options:*\n` +
                `  .antidemote revert  — restore the demoted admin\n` +
                `  .antidemote kick    — kick both demoter + demoted\n` +
                `  .antidemote demote  — demote the demoter\n` +
                `  .antidemote on      — enable (default: revert)\n` +
                `  .antidemote off     — disable`
            );
        }

        if (sub === 'on') {
            database.updateGroupSettings(from, { antidemote: true });
            await react('✅');
            return reply(`🛡️ *AntiDemote enabled* — action: *${actionLabel[action] || action}*`);
        }
        if (sub === 'off') {
            database.updateGroupSettings(from, { antidemote: false });
            await react('✅');
            return reply(`🛡️ *AntiDemote disabled.*`);
        }
        if (['revert', 'kick', 'demote'].includes(sub)) {
            database.updateGroupSettings(from, { antidemote: true, antidemoteAction: sub });
            await react('✅');
            return reply(`🛡️ *AntiDemote enabled*\n${actionLabel[sub]}`);
        }

        return reply(`❌ Usage: .antidemote on | revert | kick | demote | off`);
    }
};
