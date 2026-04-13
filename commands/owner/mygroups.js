/**
 * My Groups — lists every group the bot is in, with JID
 * Owner only
 */

const config = require('../../config');

module.exports = {
    name: 'mygroups',
    aliases: ['groups', 'grouplist', 'listgroups'],
    category: 'owner',
    description: 'List all groups the bot is in with their JIDs',
    usage: '.mygroups',
    ownerOnly: true,

    async execute(sock, msg, args, extra) {
        const jid = extra.from;

        try {
            await sock.sendMessage(jid, { react: { text: '🔄', key: msg.key } });

            // Fetch all groups bot is participating in
            const groupsObj = await sock.groupFetchAllParticipating();
            const groups = Object.values(groupsObj);

            if (!groups.length) {
                await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } });
                return extra.reply('❌ The bot is not in any groups.');
            }

            // Sort alphabetically by name
            groups.sort((a, b) => (a.subject || '').localeCompare(b.subject || ''));

            const CHUNK = 25; // groups per message to avoid length limits
            const total  = groups.length;
            const pages  = Math.ceil(total / CHUNK);

            for (let p = 0; p < pages; p++) {
                const slice = groups.slice(p * CHUNK, (p + 1) * CHUNK);
                const start = p * CHUNK + 1;

                let text = pages > 1
                    ? `📋 *Group List (${start}–${start + slice.length - 1} of ${total})*\n\n`
                    : `📋 *Group List — ${total} group${total !== 1 ? 's' : ''}*\n\n`;

                slice.forEach((g, i) => {
                    const num      = start + i;
                    const name     = g.subject || '(no name)';
                    const groupJid = g.id;
                    const members  = g.participants?.length ?? '?';
                    text += `*${num}.* ${name}\n`;
                    text += `   📌 \`${groupJid}\`\n`;
                    text += `   👥 ${members} member${members !== 1 ? 's' : ''}\n\n`;
                });

                if (p === pages - 1) {
                    text += `_Total: ${total} group${total !== 1 ? 's' : ''}_`;
                }

                await sock.sendMessage(jid, { text }, { quoted: p === 0 ? msg : undefined });

                // Brief pause between pages to avoid flooding
                if (p < pages - 1) await new Promise(r => setTimeout(r, 500));
            }

            await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } });

        } catch (error) {
            console.error('[mygroups] error:', error);
            await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } });
            await extra.reply(`❌ Failed to fetch groups: ${error.message}`);
        }
    }
};
