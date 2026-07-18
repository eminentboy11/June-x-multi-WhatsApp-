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
 * All members are fetched and kicked in one single API call.
 * If WhatsApp rejects the batch (too large), falls back to chunks of 25 with
 * a minimal 500ms gap — still much faster than the old 5-at-a-time approach.
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
        // Batch rejected — split into chunks of 25
        const CHUNK = 25;
        for (let i = 0; i < jids.length; i += CHUNK) {
            await sock.groupParticipantsUpdate(groupJid, jids.slice(i, i + CHUNK), 'remove');
            if (i + CHUNK < jids.length) await new Promise(r => setTimeout(r, 500));
        }
    }
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
                await extra.reply('🔗 Joining group from link…');
                try {
                    targetGroupJid = await sock.groupAcceptInvite(inviteCode);
                } catch (joinErr) {
                    const msg406 = joinErr.message?.includes('406') || joinErr.output?.statusCode === 406;
                    if (msg406) {
                        // Already a member — fetch the group ID via preview instead
                        try {
                            const preview = await sock.groupGetInviteInfo(inviteCode);
                            targetGroupJid = preview.id;
                            await extra.reply(`⚠️ Already a member of that group. Proceeding with kill…`);
                        } catch (_) {
                            return extra.reply('❌ Already in that group but could not fetch its ID. Try running .killgc from inside the group.');
                        }
                    } else {
                        return extra.reply(`❌ Could not join group: ${joinErr.message}`);
                    }
                }
                await extra.reply(`✅ Joined group. Fetching members…`);

            // ── Mode B: current group ─────────────────────────────────────────
            } else {
                if (!extra.isGroup) {
                    return extra.reply(
                        '❌ Run this inside a group, or pass a group link:\n' +
                        '`.killgc https://chat.whatsapp.com/XXXX`'
                    );
                }
                targetGroupJid = extra.from;
            }

            // ── Fetch members ─────────────────────────────────────────────────
            const meta         = await sock.groupMetadata(targetGroupJid);
            const participants = meta.participants || [];

            await sock.sendMessage(replyTo, {
                text: `⏳ Resolving *${participants.length}* member(s) in *${meta.subject || targetGroupJid}*…`
            });

            await preloadLidResolution(sock, participants);

            const botJid   = sock.user?.id || '';
            const botPhone = (await resolvePhone(sock, botJid)) || botJid.split('@')[0].split(':')[0];

            // Build kick list — exclude the bot itself
            const toKick = [];
            for (const p of participants) {
                let phone = await resolvePhone(sock, p.id);
                if (!phone) phone = p.id.split('@')[0].split(':')[0];
                if (phone === botPhone) continue;
                toKick.push(p.id);
            }

            if (!toKick.length) {
                await sock.sendMessage(replyTo, { text: '❌ No members to remove.' });
                await sock.groupLeave(targetGroupJid);
                return;
            }

            // ── Announce & kick ───────────────────────────────────────────────
            await sock.sendMessage(targetGroupJid, {
                text: `☠️ *Kill GC* — removing *${toKick.length}* member(s). Goodbye! 👋`,
                mentions: toKick,
            });

            await kickAll(sock, targetGroupJid, toKick);

            // ── Leave ─────────────────────────────────────────────────────────
            await sock.groupLeave(targetGroupJid);

            // Confirm back to the original chat (relevant when a link was used)
            if (inviteCode) {
                await sock.sendMessage(replyTo, {
                    text: `✅ *Kill GC done* — kicked *${toKick.length}* member(s) from *${meta.subject || targetGroupJid}* and left.`
                });
            }

        } catch (error) {
            console.error('[killgc]', error.message);
            await sock.sendMessage(replyTo, {
                text: `❌ Kill GC failed: ${error.message}`
            }).catch(() => {});
        }
    }
};
