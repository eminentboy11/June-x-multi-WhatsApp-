module.exports = {
    name: 'staff',
    aliases: ['admins', 'adminlist'],
    category: 'admin',
    description: 'Show group staff / admin list with group info',
    usage: '.staff',
    groupOnly: true,

    async execute(sock, msg, args, extra) {
        const { from, reply } = extra;

        try {
            const groupMetadata = await sock.groupMetadata(from);
            const participants = groupMetadata.participants;
            const admins = participants.filter(p => p.admin);

            let pp;
            try {
                pp = await sock.profilePictureUrl(from, 'image');
            } catch {
                pp = null;
            }

            const owner = groupMetadata.owner
                || admins.find(p => p.admin === 'superadmin')?.id
                || null;

            const adminList = admins
                .map((v, i) => `${i + 1}. @${v.id.split('@')[0]}`)
                .join('\n');

            const createdDate = groupMetadata.creation
                ? new Date(groupMetadata.creation * 1000).toLocaleDateString()
                : 'Unknown';

            const text = [
                `ℹ️ *GROUP STAFF*`,
                ``,
                `📛 *Group:* ${groupMetadata.subject}`,
                owner ? `👑 *Owner:* @${owner.split('@')[0]}` : null,
                `📅 *Created:* ${createdDate}`,
                `👥 *Members:* ${participants.length}`,
                `🛡️ *Admins:* ${admins.length}`,
                ``,
                `📋 *Admin List:*`,
                adminList
            ].filter(Boolean).join('\n');

            const mentions = [...admins.map(v => v.id), owner].filter(Boolean);

            if (pp) {
                await sock.sendMessage(from, {
                    image: { url: pp },
                    caption: text,
                    mentions
                }, { quoted: msg });
            } else {
                await sock.sendMessage(from, { text, mentions }, { quoted: msg });
            }

        } catch (err) {
            console.error('[STAFF] Error:', err.message);
            await reply('❌ Failed to fetch group staff info.');
        }
    }
};
