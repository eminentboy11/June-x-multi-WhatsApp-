/**
 * AntiPromote Command - Prevent unauthorized admin promotions
 *
 * Actions (applied to BOTH promoter and promoted member):
 *   revert  — demote the promoted member back (default)
 *   kick    — kick both the promoter and the promoted member
 *   demote  — demote the promoter (and revert the promoted member)
 */

const database = require('../../database');
const config   = require('../../config');

// Guard — prevents echo loop when the bot itself makes changes
const botCorrecting = new Set();
function markCorrecting(jid) {
    botCorrecting.add(jid);
    setTimeout(() => botCorrecting.delete(jid), 6000);
}

/** Strip bot's own JID from any list before acting — bot never acts on itself */
function excludeBot(jids, botJid) {
    const botNum = botJid.includes(':') ? botJid.split(':')[0] : botJid.split('@')[0];
    return jids.filter(j => {
        if (!j) return false;
        const num = j.split(':')[0].split('@')[0];
        return num !== botNum && j !== botJid;
    });
}

/**
 * Called from handler.js handleGroupUpdate when action === 'promote'
 */
async function handlePromote(sock, groupId, actor, promotedJid) {
    try {
        const settings = database.getGroupSettings(groupId);
        if (!settings.antipromote) return;

        // Skip bot's own corrective actions
        if (botCorrecting.has(promotedJid)) return;

        // Resolve bot JID — bot must never be included in any update
        const botJid = sock.user?.id || '';

        const action    = settings.antipromoteAction || 'revert';
        const actorNum  = actor       ? actor.split('@')[0]       : 'Unknown';
        const targetNum = promotedJid ? promotedJid.split('@')[0] : 'Unknown';
        const timestamp = new Date().toLocaleString('en-GB', {
            timeZone: config.timezone || 'Africa/Nairobi',
            hour12: false, day: '2-digit', month: '2-digit',
            year: 'numeric', hour: '2-digit', minute: '2-digit'
        });

        markCorrecting(promotedJid);
        if (actor) markCorrecting(actor);

        let actionLine = '';

        if (action === 'revert') {
            // Demote the promoted member back — never the bot
            const targets = excludeBot([promotedJid], botJid);
            if (targets.length) await sock.groupParticipantsUpdate(groupId, targets, 'demote');
            actionLine = `🔄 *Action:* Promotion reversed — member demoted back`;

        } else if (action === 'kick') {
            // Kick both the promoter AND the promoted member — never the bot
            const toKick = excludeBot([promotedJid, actor], botJid);
            if (toKick.length) await sock.groupParticipantsUpdate(groupId, toKick, 'remove');
            actionLine = `🚫 *Action:* Both parties kicked from the group`;

        } else if (action === 'demote') {
            // Revert the promoted member AND demote the promoter — never the bot
            const toAct = excludeBot([promotedJid, actor], botJid);
            if (toAct.length) await sock.groupParticipantsUpdate(groupId, toAct, 'demote');
            actionLine = `⬇️ *Action:* Promoted member reverted + promoter demoted`;
        }

        await sock.sendMessage(groupId, {
            text: [
                `⚠️ *Security Alert — AntiPromote*`,
                ``,
                `An unauthorized promotion was *detected and actioned*.`,
                ``,
                `👤 *Promoter:* @${actorNum}`,
                `🎯 *Promoted:* @${targetNum}`,
                `⏰ *Time:* ${timestamp}`,
                `${actionLine}`,
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
    description: 'Block unauthorized admin promotions with configurable action',
    usage: '.antipromote on | revert | kick | demote | off',
    groupOnly: true,
    adminOnly: true,
    botAdminNeeded: true,

    handlePromote,
    botCorrecting,

    async execute(sock, msg, args, extra) {
        const { from, reply, react } = extra;
        const sub      = args[0]?.toLowerCase();
        const settings = database.getGroupSettings(from);
        const enabled  = !!settings.antipromote;
        const action   = settings.antipromoteAction || 'revert';

        const actionLabel = {
            revert: '🔄 Revert — demote the promoted member back',
            kick:   '🚫 Kick — remove both parties from group',
            demote: '⬇️ Demote — demote both promoter and promoted'
        };

        if (!sub) {
            return reply(
                `🛡️ *AntiPromote*\n\n` +
                `Status: *${enabled ? '✅ ON' : '❌ OFF'}*\n` +
                `Action: *${enabled ? (actionLabel[action] || action) : '—'}*\n\n` +
                `Catches unauthorized promotions and acts on both parties.\n\n` +
                `*Options:*\n` +
                `  .antipromote revert  — demote the promoted member back\n` +
                `  .antipromote kick    — kick both promoter + promoted\n` +
                `  .antipromote demote  — demote both parties\n` +
                `  .antipromote on      — enable (default: revert)\n` +
                `  .antipromote off     — disable`
            );
        }

        if (sub === 'on') {
            database.updateGroupSettings(from, { antipromote: true });
            await react('✅');
            return reply(`🛡️ *AntiPromote enabled* — action: *${actionLabel[action] || action}*`);
        }
        if (sub === 'off') {
            database.updateGroupSettings(from, { antipromote: false });
            await react('✅');
            return reply(`🛡️ *AntiPromote disabled.*`);
        }
        if (['revert', 'kick', 'demote'].includes(sub)) {
            database.updateGroupSettings(from, { antipromote: true, antipromoteAction: sub });
            await react('✅');
            return reply(`🛡️ *AntiPromote enabled*\n${actionLabel[sub]}`);
        }

        return reply(`❌ Usage: .antipromote on | revert | kick | demote | off`);
    }
};
