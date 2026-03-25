module.exports = {
    name: 'getchanelid',
    aliases: ['chanelid', 'jidch', 'chatid', 'getjid', 'chjid'],
    category: 'general',
    description: 'Get JID/info of the current chat or a WhatsApp channel URL',
    usage: '.getchanelid [whatsapp channel URL]',

    async execute(sock, msg, args, extra) {
        try {
            const chatId = extra.from;
            const input  = args.join(' ').trim();

            // ── Handle WhatsApp channel URL input ──────────────────────────────
            if (input) {
                const channelMatch = input.match(
                    /(?:https?:\/\/)?(?:www\.)?whatsapp\.com\/channel\/([A-Za-z0-9_-]+)/i
                );

                if (!channelMatch) {
                    return sock.sendMessage(chatId, {
                        text: '❌ Invalid input. Provide a WhatsApp channel URL like:\nhttps://whatsapp.com/channel/0029VbBzXBN2kNFoxm7LiG3Q'
                    }, { quoted: msg });
                }

                const channelCode    = channelMatch[1];
                const newsletterJid  = `${channelCode}@newsletter`;

                // Fetch live metadata from WhatsApp
                let res;
                try {
                    res = await sock.newsletterMetadata('invite', channelCode);
                } catch (e) {
                    // Fallback: show just the JID if metadata fetch fails
                    console.error('[getchanelid] newsletterMetadata error:', e.message);
                    const fallback =
                        `📡 *WhatsApp Channel JID*\n\n` +
                        `⚠️ _Could not fetch live metadata_\n\n` +
                        `🔗 *URL:* ${input}\n` +
                        `📂 *Type:* Channel / Newsletter\n` +
                        `🔑 *Full JID:*\n\`\`\`${newsletterJid}\`\`\`\n` +
                        `🔢 *Channel Code:*\n\`\`\`${channelCode}\`\`\``;
                    return sock.sendMessage(chatId, { text: fallback }, { quoted: msg });
                }

                const isVerified   = res.verification === 'VERIFIED';
                const subscriberFmt = res.subscribers?.toLocaleString?.() ?? res.subscribers ?? 'N/A';

                const text =
                    `📡 *WhatsApp Channel Info*\n\n` +
                    `📌 *Name:* ${res.name || 'N/A'}\n` +
                    `👥 *Followers:* ${subscriberFmt}\n` +
                    `📊 *Status:* ${res.state || 'N/A'}\n` +
                    `✅ *Verified:* ${isVerified ? 'Yes ✔️' : 'No'}\n\n` +
                    `🔑 *Full JID:*\n\`\`\`${res.id || newsletterJid}\`\`\`\n` +
                    `🔢 *Channel ID:*\n\`\`\`${(res.id || newsletterJid).split('@')[0]}\`\`\``;

                return sock.sendMessage(chatId, { text }, { quoted: msg });
            }

            // ── No input — return current chat JID ─────────────────────────────
            const isGroup      = chatId.endsWith('@g.us');
            const isNewsletter = chatId.endsWith('@newsletter');

            let type = 'Private Chat';
            if (isGroup)      type = 'Group';
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
