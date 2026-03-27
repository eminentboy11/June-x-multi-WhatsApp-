/**
 * Reject Command - Reject pending group join requests
 */

module.exports = {
    name: 'reject',
    aliases: ['rejectjoin', 'declinejoin', 'decline'],
    category: 'admin',
    description: 'Reject pending group join requests',
    usage: '.reject all | @user',
    groupOnly: true,
    adminOnly: true,
    botAdminNeeded: true,

    async execute(sock, msg, args, extra) {
        const { from, reply, react } = extra;
        const sub = args[0]?.toLowerCase();

        const getPending = async () => {
            try {
                return await sock.groupRequestParticipantsList(from) || [];
            } catch {
                return [];
            }
        };

        // ── reject all ────────────────────────────────────────────────────
        if (sub === 'all') {
            const pending = await getPending();
            if (!pending.length) return reply(`⚠️ No pending join requests.`);

            const jids = pending.map(r => r.jid);
            await sock.groupRequestParticipantsUpdate(from, jids, 'reject');
            await react('✅');
            return await sock.sendMessage(from, {
                text: `🚫 *Rejected ${jids.length} join request${jids.length !== 1 ? 's' : ''}.*`
            }, { quoted: msg });
        }

        // ── reject @user ──────────────────────────────────────────────────
        const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        const quoted    = msg.message?.extendedTextMessage?.contextInfo?.participant;
        let targetJid   = mentioned[0] || quoted || null;

        if (!targetJid && args[0]) {
            const num = args[0].replace(/\D/g, '');
            if (num.length >= 7) targetJid = `${num}@s.whatsapp.net`;
        }

        if (!targetJid) {
            return reply(
                `❌ *Usage:*\n` +
                `  .reject all — reject all pending requests\n` +
                `  .reject @user — reject a specific user`
            );
        }

        await sock.groupRequestParticipantsUpdate(from, [targetJid], 'reject');
        await react('✅');
        const num = targetJid.split('@')[0];
        return await sock.sendMessage(from, {
            text: `🚫 *@${num}*'s join request has been rejected.`,
            mentions: [targetJid]
        }, { quoted: msg });
    }
};
