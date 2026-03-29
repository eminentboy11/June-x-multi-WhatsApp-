module.exports = {
    name: 'listonline',
    aliases: ['listactive', 'activeusers', 'activemembers'],
    category: 'admin',
    description: 'Show most active users in the group by message count',
    usage: '.listonline',
    groupOnly: true,
    adminOnly: true,

    async execute(sock, msg, args, extra) {
        const { from, isGroup, reply, groupName, getActiveUsers } = extra;

        if (!isGroup) return reply(global.mess?.notgroup || '❌ This command can only be used in groups.');

        const activeUsers = getActiveUsers(from, 15);

        if (!activeUsers.length) {
            return reply('*📊 No active users found in this group.*\n\nSend some messages first to track activity!');
        }

        let message = `📊 *ACTIVE USERS - ${groupName || 'This Group'}*\n\n`;

        activeUsers.forEach((user, index) => {
            const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🔹';
            message += `${medal} ${index + 1}. @${user.jid.split('@')[0]} - *${user.count} messages*\n`;
        });

        message += `\n📈 *Total tracked users:* ${activeUsers.length}`;

        await sock.sendMessage(msg.key.remoteJid, {
            text: message,
            mentions: activeUsers.map(u => u.jid)
        }, { quoted: msg });
    }
};
