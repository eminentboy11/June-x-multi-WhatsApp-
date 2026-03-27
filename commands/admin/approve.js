/**
 * Approve/Reject Command - Manage group join requests
 */

module.exports = {
    name: 'approve',
    aliases: ['acceptjoin', 'approvejoin'],
    category: 'admin',
    description: 'Approve or reject pending group join requests',
    usage: '.approve all | @user | none',
    groupOnly: true,
    adminOnly: true,
    botAdminNeeded: true,

    async execute(sock, msg, args, extra) {
        const { from, reply, react } = extra;
        const sub = args[0]?.toLowerCase();

        // ── Helper: fetch pending requests ────────────────────────────────
        const getPending = async () => {
            try {
                return await sock.groupRequestParticipantsList(from) || [];
            } catch {
                return [];
            }
        };

        // ── No args: show pending list ────────────────────────────────────
        if (!sub) {
            const pending = await getPending();
            if (!pending.length) {
                return reply(`✅ No pending join requests in this group.`);
            }
            const list = pending.map((r, i) => `  ${i + 1}. @${r.jid.split('@')[0]}`).join('\n');
            return await sock.sendMessage(from, {
                text: `📋 *Pending Join Requests (${pending.length})*\n\n${list}\n\n` +
                      `Use:\n` +
                      `  • *.approve all* — approve everyone\n` +
                      `  • *.approve @user* — approve one person\n` +
                      `  • *.approve none* — reject everyone\n` +
                      `  • *.reject @user* — reject one person`,
                mentions: pending.map(r => r.jid)
            }, { quoted: msg });
        }

        // ── approve all ───────────────────────────────────────────────────
        if (sub === 'all') {
            const pending = await getPending();
            if (!pending.length) return reply(`⚠️ No pending join requests.`);

            const jids = pending.map(r => r.jid);
            await sock.groupRequestParticipantsUpdate(from, jids, 'approve');
            await react('✅');
            return await sock.sendMessage(from, {
                text: `✅ *Approved ${jids.length} join request${jids.length !== 1 ? 's' : ''}.*`,
            }, { quoted: msg });
        }

        // ── approve none (reject all) ─────────────────────────────────────
        if (sub === 'none') {
            const pending = await getPending();
            if (!pending.length) return reply(`⚠️ No pending join requests.`);

            const jids = pending.map(r => r.jid);
            await sock.groupRequestParticipantsUpdate(from, jids, 'reject');
            await react('✅');
            return await sock.sendMessage(from, {
                text: `🚫 *Rejected ${jids.length} join request${jids.length !== 1 ? 's' : ''}.*`,
            }, { quoted: msg });
        }

        // ── approve @user ─────────────────────────────────────────────────
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
                `  .approve all — approve all pending requests\n` +
                `  .approve @user — approve a specific user\n` +
                `  .approve none — reject all pending requests`
            );
        }

        await sock.groupRequestParticipantsUpdate(from, [targetJid], 'approve');
        await react('✅');
        const num = targetJid.split('@')[0];
        return await sock.sendMessage(from, {
            text: `✅ *@${num}* has been approved to join the group.`,
            mentions: [targetJid]
        }, { quoted: msg });
    }
};
