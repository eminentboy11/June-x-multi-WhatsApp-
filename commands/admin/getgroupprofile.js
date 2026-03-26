/**
 * Get Group Profile - Fetch the group's profile picture
 */

const axios = require('axios');

module.exports = {
    name: 'getgroupprofile',
    aliases: ['ggp', 'grouppp', 'groupphoto'],
    category: 'admin',
    description: "Get the group's profile picture",
    usage: '.getgroupprofile',
    groupOnly: true,

    async execute(sock, msg, args, extra) {
        const chatId = extra.from;

        try {
            const ppUrl = await sock.profilePictureUrl(chatId, 'image');

            if (!ppUrl) {
                return extra.reply('❌ This group has no profile picture set.');
            }

            const response = await axios.get(ppUrl, { responseType: 'arraybuffer' });
            const buffer = Buffer.from(response.data);

            await sock.sendMessage(chatId, {
                image: buffer,
                caption: `🖼️ *Group Profile Picture*\n📋 Group: ${extra.groupMetadata.subject}`
            }, { quoted: msg });

        } catch (error) {
            if (error.message?.includes('item-not-found') || error.output?.statusCode === 404) {
                return extra.reply('❌ This group has no profile picture set.');
            }
            console.error('getgroupprofile error:', error);
            extra.reply('❌ Failed to fetch group profile picture.');
        }
    }
};
