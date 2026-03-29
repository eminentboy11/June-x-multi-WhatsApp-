module.exports = {
    name: 'listoffline',
    aliases: ['listinactive', 'inactiveusers', 'inactivemembers'],
    category: 'admin',
    description: 'Show inactive users who have not sent any messages in the group',
    usage: '.listoffline',
    groupOnly: true,
    adminOnly: true,

    async execute(sock, msg, args, extra) {
        const { from, isGroup, reply, groupName, getInactiveUsers } = extra;

        if (!isGroup) return reply(global.mess?.notgroup || '❌ This command can only be used in groups.');

        try {
            const metadata = await sock.groupMetadata(from);
            const allParticipants = metadata.participants.map(p => p.id);
            const inactiveUsers = getInactiveUsers(from, allParticipants);

            if (!inactiveUsers.length) {
                return reply('*✅ No inactive users found in this group!*\n\nAll participants have sent messages.');
            }

            let message = `⚠️ *INACTIVE USERS - ${groupName || 'This Group'}*\n\n`;
            message += `_Users who haven't sent any messages:_\n\n`;
            message += inactiveUsers.map((user, i) => `🔹 ${i + 1}. @${user.split('@')[0]}`).join('\n');
            message += `\n\n📊 *Total inactive:* ${inactiveUsers.length}`;

            await sock.sendMessage(msg.key.remoteJid, {
                text: message,
                mentions: inactiveUsers
            }, { quoted: msg });

        } catch (error) {
            console.error('Error in listoffline command:', error);
            reply('❌ *Error fetching group data!*');
        }
    }
};
