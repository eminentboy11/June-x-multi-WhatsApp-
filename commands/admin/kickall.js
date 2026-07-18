/**
 * ╔════════════════════════════════════════════════════════╗
 * ║  FILE    : kickall.js                                  ║
 * ║  FEATURE : Kick all members / Kill group chat          ║
 * ║  SCOPE   : Owner — Group only                          ║
 * ╚════════════════════════════════════════════════════════╝
 *
 * .kickall  — tag and remove all non-admin members
 * .killgc   — same, then bot leaves the group
 *
 * Uses the same LID resolution strategy as antiforeign.js so
 * the bot correctly identifies and skips itself even when its
 * own JID is a LID, and so member tags show real phone numbers.
 */

const path = require('path');
const { resolvePhone, preloadLidResolution } = require(path.join(global.__ROOT__, 'utils', 'jidHelper'));

module.exports = [
    {
        name: 'kickall',
        aliases: ['removeall', 'killgc'],
        category: 'admin',
        description: 'Remove all non-admin members from the group. killgc also makes the bot leave.',
        usage: '.kickall | .removeall | .killgc',
        ownerOnly: true,
        groupOnly: true,
        adminOnly: true,
        botAdminNeeded: true,

        async execute(sock, msg, args, extra) {
            const chatId    = extra.from;
            const isKillGc  = extra.command === 'killgc';

            try {
                const meta         = await sock.groupMetadata(chatId);
                const participants = meta.participants || [];

                await extra.reply('⏳ Resolving member numbers, this may take a few seconds…');
                await preloadLidResolution(sock, participants);

                // Resolve bot's real phone number (works for LID JIDs too)
                const botJid   = sock.user?.id || '';
                const botPhone = (await resolvePhone(sock, botJid)) || botJid.split('@')[0].split(':')[0];

                // Collect everyone except the bot itself
                const toKick = [];
                for (const p of participants) {
                    let phone = await resolvePhone(sock, p.id);
                    if (!phone) phone = p.id.split('@')[0].split(':')[0];
                    if (phone === botPhone) continue;   // never kick the bot
                    toKick.push({ ...p, phone });
                }

                if (toKick.length === 0) {
                    return extra.reply('❌ No members to remove.');
                }

                const jids     = toKick.map(p => p.id);
                const tagLines = toKick.map(p => `@${p.phone}`).join(' ');

                await sock.sendMessage(chatId, {
                    text: `🚨 *${isKillGc ? 'Kill GC' : 'Kickall'} initiated* — removing *${toKick.length}* member(s):\n\n${tagLines}`,
                    mentions: jids,
                });

                // Kick in batches of 5 with delay to avoid rate-limits (same as antiforeign)
                for (let i = 0; i < jids.length; i += 5) {
                    await sock.groupParticipantsUpdate(chatId, jids.slice(i, i + 5), 'remove');
                    if (i + 5 < jids.length) await new Promise(r => setTimeout(r, 1500));
                }

                if (isKillGc) {
                    await sock.sendMessage(chatId, { text: '✅ All members removed. Goodbye! 👋' });
                    await sock.groupLeave(chatId);
                } else {
                    await extra.reply('✅ All members have been removed successfully.');
                }

            } catch (error) {
                console.error('[kickall/killgc]', error.message);
                await extra.reply('❌ Failed to remove members. Make sure I am an admin.');
            }
        },
    },
];
