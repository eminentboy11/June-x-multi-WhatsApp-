/**
 * Get Group Description - Fetch the group's current description
 */

module.exports = {
    name: 'getgroupdesc',
    aliases: ['groupdesc', 'gdesc', 'description'],
    category: 'admin',
    description: "Get the group's description",
    usage: '.getgroupdesc',
    groupOnly: true,

    async execute(sock, msg, args, extra) {
        const chatId = extra.from;

        try {
            const metadata = extra.groupMetadata;
            const desc = metadata.desc?.trim();
            const groupName = metadata.subject || 'This group';

            if (!desc) {
                return extra.reply(`ℹ️ *${groupName}* has no description set.`);
            }

            const createdAt = metadata.descTime
                ? new Date(metadata.descTime * 1000).toLocaleString()
                : 'Unknown';

            const setBy = metadata.descOwner
                ? `@${metadata.descOwner.split('@')[0]}`
                : 'Unknown';

            let text = `📋 *Group Description*\n\n`;
            text += `🏷️ Group: *${groupName}*\n`;
            text += `🕒 Set on: ${createdAt}\n`;
            text += `👤 Set by: ${setBy}\n\n`;
            text += `📝 ${desc}`;

            const mentions = metadata.descOwner ? [metadata.descOwner] : [];

            await sock.sendMessage(chatId, { text, mentions }, { quoted: msg });

        } catch (error) {
            console.error('getgroupdesc error:', error);
            extra.reply('❌ Failed to fetch group description.');
        }
    }
};
