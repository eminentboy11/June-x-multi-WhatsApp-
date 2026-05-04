/**
 * My Groups — lists every group the bot is in.
 * .mygroups         → full list (one message)
 * .mygroups <n>     → full details of group #n
 * Owner only
 */

const config = require(require('path').join(global.__ROOT__, 'config'));
const { sendButtons } = require('gifted-btns');

module.exports = {
    name: 'mygroups',
    aliases: ['groups', 'grouplist', 'listgroups'],
    category: 'owner',
    description: 'List all groups the bot is in. Reply with a number for group details.',
    usage: '.mygroups | .mygroups <number>',
    ownerOnly: true,

    async execute(sock, msg, args, extra) {
        const jid = extra.from;

        try {
            await sock.sendMessage(jid, { react: { text: '🔄', key: msg.key } });

            // Fetch and sort all groups
            const groupsObj = await sock.groupFetchAllParticipating();
            const groups = Object.values(groupsObj)
                .sort((a, b) => (a.subject || '').localeCompare(b.subject || ''));

            if (!groups.length) {
                await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } });
                return extra.reply('❌ The bot is not in any groups.');
            }

            const total = groups.length;

            // ── Detail view (when number argument is given) ──────────────────
            const numArg = args[0];
            if (numArg && /^\d+$/.test(numArg)) {
                const idx = parseInt(numArg) - 1;
                if (idx < 0 || idx >= total) {
                    return extra.reply(`❌ Pick a number between 1 and ${total}.`);
                }

                const g = groups[idx];
                const members    = g.participants || [];
                const admins     = members.filter(p => p.admin).map(p => `@${p.id.split('@')[0].split(':')[0]}`);
                const memberCount = members.length;
                const groupJid   = g.id;
                const name       = g.subject || '(no name)';
                const desc       = g.desc ? g.desc.trim() : 'No description';
                const createdAt  = g.creation
                    ? new Date(g.creation * 1000).toLocaleString('en-GB', { timeZone: 'Africa/Nairobi' })
                    : 'Unknown';
                const botMeta    = members.find(p => {
                    const phone = (sock.user?.id || '').split('@')[0].split(':')[0];
                    return p.id.split('@')[0].split(':')[0] === phone;
                });
                const botRole    = botMeta?.admin === 'superadmin' ? '👑 Super Admin' : botMeta?.admin ? '🔰 Admin' : '👤 Member';

                const detail =
`━━━━━━━━━━━━━━━━━━━
📋 *Group Details — #${numArg}*
━━━━━━━━━━━━━━━━━━━

🏷️  *Name:* ${name}
👥  *Members:* ${memberCount}
🤖  *Bot role:* ${botRole}
📅  *Created:* ${createdAt}
🧩  *GroupJid:* ${groupJid}
📝  *Description:*
${desc}

━━━━━━━━━━━━━━━━━━━`;

                await sendButtons(sock, jid, {
                    text: detail,
                    footer: `> Powered by ${config.botName}`,
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

            // ── List view — all groups in one message (no pagination) ────────
            let text = `📋 *Group List — ${total} group${total !== 1 ? 's' : ''}*\n\n`;

            groups.forEach((g, idx) => {
                const num = idx + 1;
                const name = g.subject || '(no name)';
                const members = g.participants?.length ?? '?';
                text += `*${num}.* ${name}\n`;
                text += `   👥 ${members} member${members !== 1 ? 's' : ''}\n\n`;
            });

            text += `_Total: ${total} group${total !== 1 ? 's' : ''}_\n\n`;
            text += `💡 *Reply to this message with* \`.mygroups <number>\` *for group details + copy JID.*`;

            // Send the complete list in a single message
            await sock.sendMessage(jid, { text }, { quoted: msg });
            await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } });

        } catch (error) {
            console.error('[mygroups] error:', error);
            await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } });
            await extra.reply(`❌ Failed to fetch groups: ${error.message}`);
        }
    }
};
