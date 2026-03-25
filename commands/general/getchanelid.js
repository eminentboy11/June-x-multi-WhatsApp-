module.exports = {
    name: 'getchanelid',
    aliases: ['chanelid', 'jidch', 'chatid', 'getjid'],
    category: 'general',
    description: 'Get the JID (ID) of the current chat or group',
    usage: '.getchanelid',

    async execute(sock, msg, args, extra) {
        try {
            const chatId = extra.from;
            const isGroup = chatId.endsWith('@g.us');
            const isNewsletter = chatId.endsWith('@newsletter');

            let type = 'Private Chat';
            if (isGroup) type = 'Group';
            else if (isNewsletter) type = 'Channel/Newsletter';

            const jidNum = chatId.split('@')[0];

            let groupName = '';
            if (isGroup && extra.groupMetadata) {
                groupName = `\n📌 *Name:* ${extra.groupMetadata.subject || 'Unknown'}`;
            }

            const text = `🆔 *Chat JID Info*\n\n` +
                `📂 *Type:* ${type}` +
                `${groupName}\n` +
                `🔑 *JID:* \`${chatId}\`\n` +
                `🔢 *ID Number:* \`${jidNum}\``;

            await sock.sendMessage(chatId, { text }, { quoted: msg });

        } catch (error) {
            console.error('Error in getchanelid command:', error);
            await extra.reply('❌ Failed to get chat ID.');
        }
    }
};
