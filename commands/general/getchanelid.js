module.exports = {
    name: 'getchanelid',
    aliases: ['chanelid', 'jidch', 'chatid', 'getjid'],
    category: 'general',
    description: 'Get the JID of the current chat, group, or WhatsApp channel URL',
    usage: '.getchanelid [whatsapp channel URL]',

    async execute(sock, msg, args, extra) {
        try {
            const chatId = extra.from;
            const input = args.join(' ').trim();

            // ── Handle WhatsApp channel URL input ──────────────────────────────
            if (input) {
                const channelMatch = input.match(
                    /(?:https?:\/\/)?(?:www\.)?whatsapp\.com\/channel\/([A-Za-z0-9_-]+)/i
                );

                if (channelMatch) {
                    const channelCode = channelMatch[1];
                    const newsletterJid = `${channelCode}@newsletter`;

                    const text =
                        `📡 *WhatsApp Channel JID*\n\n` +
                        `🔗 *URL:* ${input}\n` +
                        `📂 *Type:* Channel / Newsletter\n` +
                        `🔑 *JID:*\n\`\`\`${newsletterJid}\`\`\`\n` +
                        `🔢 *Channel Code:*\n\`\`\`${channelCode}\`\`\``;

                    return await sock.sendMessage(chatId, { text }, { quoted: msg });
                }

                return await sock.sendMessage(chatId, {
                    text: '❌ Invalid input. Provide a WhatsApp channel URL like:\nhttps://whatsapp.com/channel/0029VbBzXBN2kNFoxm7LiG3Q'
                }, { quoted: msg });
            }

            // ── No input — return current chat JID ─────────────────────────────
            const isGroup = chatId.endsWith('@g.us');
            const isNewsletter = chatId.endsWith('@newsletter');

            let type = 'Private Chat';
            if (isGroup) type = 'Group';
            else if (isNewsletter) type = 'Channel / Newsletter';

            const jidNum = chatId.split('@')[0];

            let nameLine = '';
            if (isGroup && extra.groupMetadata) {
                nameLine = `\n📌 *Name:* ${extra.groupMetadata.subject || 'Unknown'}`;
            }

            const text =
                `🆔 *Chat JID Info*\n\n` +
                `📂 *Type:* ${type}` +
                `${nameLine}\n` +
                `🔑 *Full JID:*\n\`\`\`${chatId}\`\`\`\n` +
                `🔢 *ID / Number:*\n\`\`\`${jidNum}\`\`\``;

            await sock.sendMessage(chatId, { text }, { quoted: msg });

        } catch (error) {
            console.error('Error in getchanelid command:', error);
            await extra.reply('❌ Failed to get chat ID.');
        }
    }
};
