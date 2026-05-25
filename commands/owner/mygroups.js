/**
 * My Groups — lists every group the bot is in.
 * .mygroups         → full list (sent to owner DM)
 * .mygroups <n>     → full details of group #n (sent to owner DM)
 * Owner only
 */

const config      = require('../../config');
const { sendButtons } = require('gifted-btns');
const { applyFont } = require('../../utils/fontConverter');


module.exports = {
    name: 'mygroups',
    aliases: ['groups', 'grouplist', 'listgroups'],
    category: 'owner',
    description: 'List all groups the bot is in. Reply with a number for group details.',
    usage: '.mygroups | .mygroups <number>',
    ownerOnly: true,

    async execute(sock, msg, args, extra) {
        const jid = extra.from;

        // Always respond privately to the owner
        const ownerJid = (config.ownerNumber || '').replace(/\D/g, '') + '@s.whatsapp.net';
        const replyJid = ownerJid || jid;

        try {
            await sock.sendMessage(jid, { react: { text: '🔄', key: msg.key } });

            // Fetch and sort all groups
            const groupsObj = await sock.groupFetchAllParticipating();
            const groups = Object.values(groupsObj)
                .sort((a, b) => (a.subject || '').localeCompare(b.subject || ''));

            if (!groups.length) {
                await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } });
                return sock.sendMessage(replyJid, {
                    text: applyFont('❌ The bot is not in any groups.')
                });
            }

            const total = groups.length;

            // ── Detail view (when number argument is given) ──────────────────
            const numArg = args[0];
            if (numArg && /^\d+$/.test(numArg)) {
                const idx = parseInt(numArg) - 1;

                if (idx < 0 || idx >= total) {
                    await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } });
                    return sock.sendMessage(replyJid, {
                        text: applyFont(`❌ Invalid number. Pick a number between 1 and ${total}.`)
                    });
                }

                const g           = groups[idx];
                const members     = g.participants || [];
                const admins      = members
                    .filter(p => p.admin)
                    .map(p => `@${p.id.split('@')[0].split(':')[0]}`);
                const memberCount = members.length;
                const adminCount  = admins.length;
                const groupJid    = g.id;
                const name        = g.subject || '(no name)';
                const desc        = g.desc ? g.desc.trim() : 'No description';
                const createdAt   = g.creation
                    ? new Date(g.creation * 1000).toLocaleString('en-GB', { timeZone: 'Africa/Nairobi' })
                    : 'Unknown';
                const announce    = g.announce ? '🔒 Admins only' : '🔓 Everyone';
                const restrict    = g.restrict  ? '🔒 Admins only' : '🔓 Everyone';

                const botMeta = members.find(p => {
                    const phone = (sock.user?.id || '').split('@')[0].split(':')[0];
                    return p.id.split('@')[0].split(':')[0] === phone;
                });
                const botRole = botMeta?.admin === 'superadmin'
                    ? '👑 Super Admin'
                    : botMeta?.admin
                        ? '🔰 Admin'
                        : '👤 Member';

                const detail = applyFont(
`━━━━━━━━━━━━━━━━━━━
📋 Group Details — #${numArg}
━━━━━━━━━━━━━━━━━━━

🏷️  Name: ${name}
👥  Members: ${memberCount}
🛡️  Admins: ${adminCount}
🤖  Bot Role: ${botRole}
📅  Created: ${createdAt}
💬  Send Messages: ${announce}
✏️  Edit Info: ${restrict}
🧩  Group JID: ${groupJid}

📝  Description:
${desc}

━━━━━━━━━━━━━━━━━━━
${admins.length ? '👮 Admins: ' + admins.join(', ') : '👮 No admins found'}
━━━━━━━━━━━━━━━━━━━`
                );

                await sendButtons(sock, replyJid, {
                    text: detail,
                    footer: applyFont(`> Powered by ${config.botName}`),
                    buttons: [
                        {
                            name: 'cta_copy',
                            buttonParamsJson: JSON.stringify({
                                display_text: '📋 Copy JID',
                                copy_code: groupJid
                            })
                        }
                    ]
                }, { quoted: msg });

                await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } });
                return;
            }

            // ── List view — all groups in one message ────────────────────────
            let text = `━━━━━━━━━━━━━━━━━━━\n`;
            text += `📋 My Groups — ${total} group${total !== 1 ? 's' : ''}\n`;
            text += `━━━━━━━━━━━━━━━━━━━\n\n`;

            groups.forEach((g, idx) => {
                const name    = g.subject || '(no name)';
                const members = g.participants?.length ?? '?';
                const botMeta = (g.participants || []).find(p => {
                    const phone = (sock.user?.id || '').split('@')[0].split(':')[0];
                    return p.id.split('@')[0].split(':')[0] === phone;
                });
                const role = botMeta?.admin === 'superadmin'
                    ? '👑'
                    : botMeta?.admin
                        ? '🔰'
                        : '👤';

                text += `${idx + 1}. ${name}\n`;
                text += `   👥 ${members} member${members !== 1 ? 's' : ''}  ${role}\n\n`;
            });

            text += `━━━━━━━━━━━━━━━━━━━\n`;
            text += `Total: ${total} group${total !== 1 ? 's' : ''}\n\n`;
            text += `👑 Super Admin  🔰 Admin  👤 Member\n\n`;
            text += `💡 Use .mygroups <number> for full details & copy JID.`;

            await sock.sendMessage(replyJid, { text: applyFont(text) }, { quoted: msg });
            await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } });

        } catch (error) {
            console.error('[mygroups] error:', error);
            await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } });
            await sock.sendMessage(replyJid, {
                text: applyFont(`❌ Failed to fetch groups.\n\nError: ${error.message}`)
            });
        }
    }
};
