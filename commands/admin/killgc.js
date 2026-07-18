/**
 * ╔════════════════════════════════════════════════════════╗
 * ║  FILE    : killgc.js                                   ║
 * ║  FEATURE : Kill Group Chat — kick all members & leave  ║
 * ║  SCOPE   : Owner only                                  ║
 * ╚════════════════════════════════════════════════════════╝
 *
 * Usage:
 *   .killgc                              — kick all members in current group, then leave
 *   .killgc https://chat.whatsapp.com/X  — join that group, kick everyone, then leave
 *
 * For the link mode, the bot must already be admin in the target group —
 * this is verified remotely via groupMetadata before any kick attempt.
 * If the bot is not admin, the command aborts with a single error reply.
 */

const path = require('path');
const { resolvePhone, preloadLidResolution } = require(path.join(global.__ROOT__, 'utils', 'jidHelper'));

// Extract invite code from a WhatsApp group link
function extractInviteCode(input) {
    if (!input) return null;
    const m = input.match(/chat\.whatsapp\.com\/([A-Za-z0-9_-]+)/);
    return m ? m[1] : (/^[A-Za-z0-9_-]{10,}$/.test(input.trim()) ? input.trim() : null);
}

// Kick all JIDs in one call; if WhatsApp rejects, fall back to chunks of 25
async function kickAll(sock, groupJid, jids) {
    if (!jids.length) return;
    try {
        await sock.groupParticipantsUpdate(groupJid, jids, 'remove');
    } catch (firstErr) {
        const CHUNK = 25;
        for (let i = 0; i < jids.length; i += CHUNK) {
            await sock.groupParticipantsUpdate(groupJid, jids.slice(i, i + CHUNK), 'remove');
            if (i + CHUNK < jids.length) await new Promise(r => setTimeout(r, 500));
        }
    }
}

// Check whether the bot is admin in the given group's metadata
function botIsAdmin(meta, botJid) {
    const botUser = botJid.split('@')[0].split(':')[0];
    const me = (meta.participants || []).find(p => {
        const pu = p.id.split('@')[0].split(':')[0];
        return pu === botUser;
    });
    return !!me && (me.admin === 'admin' || me.admin === 'superadmin');
}

module.exports = {
    name: 'killgc',
    aliases: ['killgv'],
    category: 'admin',
    description: 'Kick all members from a group and leave. Optionally pass a group link.',
    usage: '.killgc [group link]',
    ownerOnly: true,
    botAdminNeeded: true,

    async execute(sock, msg, args, extra) {
        const replyTo = extra.from;
        const inviteCode = extractInviteCode(args[0]);

        try {
            let targetGroupJid;

            // ── Mode A: group link provided ───────────────────────────────────
            if (inviteCode) {
                try {
                    targetGroupJid = await sock.groupAcceptInvite(inviteCode);
                } catch (joinErr) {
                    const msg406 = joinErr.message?.includes('406') || joinErr.output?.statusCode === 406;
                    if (msg406) {
                        try {
                            const preview = await sock.groupGetInviteInfo(inviteCode);
                            targetGroupJid = preview.id;
                        } catch (_) {
                            return extra.reply('❌ Already in that group but could not resolve its ID.');
                        }
                    } else {
                        return extra.reply(`❌ Could not join group: ${joinErr.message}`);
                    }
                }

                // ── Remote admin check — required before doing anything else ───
                const meta = await sock.groupMetadata(targetGroupJid);
                const botJid = sock.user?.id || '';
                if (!botIsAdmin(meta, botJid)) {
                    await sock.groupLeave(targetGroupJid).catch(() => {});
                    return extra.reply('❌ Bot is not admin in that group. Aborting.');
                }

                // Fall through to kick logic below using this meta (skip re-fetch)
                return await runKill(sock, targetGroupJid, meta, replyTo, extra, true);

            // ── Mode B: current group ─────────────────────────────────────────
            } else {
                if (!extra.isGroup) {
                    return extra.reply(
                        '❌ Run this inside a group, or pass a group link:\n' +
                        '`.killgc https://chat.whatsapp.com/XXXX`'
                    );
                }
                targetGroupJid = extra.from;
                const meta = await sock.groupMetadata(targetGroupJid);
                const botJid = sock.user?.id || '';
                if (!botIsAdmin(meta, botJid)) {
                    return extra.reply('❌ Bot is not admin in this group. Aborting.');
                }
                return await runKill(sock, targetGroupJid, meta, replyTo, extra, false);
            }

        } catch (error) {
            console.error('[killgc]', error.message);
            await sock.sendMessage(replyTo, { text: `❌ Kill GC failed: ${error.message}` }).catch(() => {});
        }
    }
};

// Shared kick + leave logic, called once admin status is confirmed
async function runKill(sock, targetGroupJid, meta, replyTo, extra, viaLink) {
    const participants = meta.participants || [];
    await preloadLidResolution(sock, participants);

    const botJid   = sock.user?.id || '';
    const botPhone = (await resolvePhone(sock, botJid)) || botJid.split('@')[0].split(':')[0];

    const toKick = [];
    for (const p of participants) {
        let phone = await resolvePhone(sock, p.id);
        if (!phone) phone = p.id.split('@')[0].split(':')[0];
        if (phone === botPhone) continue;
        toKick.push(p.id);
    }

    if (!toKick.length) {
        await sock.groupLeave(targetGroupJid).catch(() => {});
        return extra.reply('❌ No members to remove.');
    }

    await sock.sendMessage(targetGroupJid, {
        text: `☠️ *Kill GC* — removing *${toKick.length}* member(s). Goodbye! 👋`,
        mentions: toKick,
    });

    await kickAll(sock, targetGroupJid, toKick);
    await sock.groupLeave(targetGroupJid);

    if (viaLink) {
        await sock.sendMessage(replyTo, {
            text: `✅ Kicked *${toKick.length}* from *${meta.subject || targetGroupJid}* and left.`
        });
    }
}
