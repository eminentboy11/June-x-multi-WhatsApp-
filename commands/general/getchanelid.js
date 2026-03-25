const { sendButtons } = require('gifted-btns');
const config = require('../../config');

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
            const footer = `> Powered by ${config.botName}`;

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

                const channelCode   = channelMatch[1];
                const newsletterJid = `${channelCode}@newsletter`;
                const channelUrl    = `https://whatsapp.com/channel/${channelCode}`;

                // Fetch live metadata from WhatsApp
                let res;
                try {
                    res = await sock.newsletterMetadata('invite', channelCode);
                } catch (e) {
                    console.error('[getchanelid] newsletterMetadata error:', e.message);

                    // Fallback with buttons
                    const fallback =
                        `📡 *WhatsApp Channel JID*\n\n` +
                        `⚠️ _Could not fetch live metadata_\n\n` +
                        `🔗 *URL:* ${channelUrl}\n` +
                        `📂 *Type:* Channel / Newsletter\n` +
                        `🔑 *Full JID:*\n\`\`\`${newsletterJid}\`\`\`\n` +
                        `🔢 *Channel Code:*\n\`\`\`${channelCode}\`\`\``;

                    return sendButtons(sock, chatId, {
                        text: fallback,
                        footer,
                        buttons: [
                            {
                                name: 'cta_url',
                                buttonParamsJson: JSON.stringify({
                                    display_text: '📡 Open Channel',
                                    url: channelUrl
                                })
                            },
                            {
                                name: 'cta_copy',
                                buttonParamsJson: JSON.stringify({
                                    display_text: '📋 Copy JID',
                                    copy_code: newsletterJid
                                })
                            }
                        ]
                    }, { quoted: msg });
                }

                const isVerified     = res.verification === 'VERIFIED';
                const subscriberFmt  = res.subscribers?.toLocaleString?.() ?? res.subscribers ?? 'N/A';
                const resolvedJid    = res.id || newsletterJid;
                const resolvedCode   = resolvedJid.split('@')[0];

                const text =
                    `📡 *WhatsApp Channel Info*\n\n` +
                    `📌 *Name:* ${res.name || 'N/A'}\n` +
                    `👥 *Followers:* ${subscriberFmt}\n` +
                    `📊 *Status:* ${res.state || 'N/A'}\n` +
                    `✅ *Verified:* ${isVerified ? 'Yes ✔️' : 'No'}\n\n` +
                    `🔑 *Full JID:*\n\`\`\`${resolvedJid}\`\`\`\n` +
                    `🔢 *Channel ID:*\n\`\`\`${resolvedCode}\`\`\``;

                return sendButtons(sock, chatId, {
                    text,
                    footer,
                    buttons: [
                        {
                            name: 'cta_url',
                            buttonParamsJson: JSON.stringify({
                                display_text: '📡 Open Channel',
                                url: channelUrl
                            })
                        },
                        {
                            name: 'cta_copy',
                            buttonParamsJson: JSON.stringify({
                                display_text: '📋 Copy JID',
                                copy_code: resolvedJid
                            })
                        }
                    ]
                }, { quoted: msg });
            }

            // ── No input — return current chat JID ─────────────────────────────
            const isGroup      = chatId.endsWith('@g.us');
            const isNewsletter = chatId.endsWith('@newsletter');

            let type = 'Private Chat';
            if (isGroup)           type = 'Group';
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

            await sendButtons(sock, chatId, {
                text,
                footer,
                buttons: [
                    {
                        name: 'cta_copy',
                        buttonParamsJson: JSON.stringify({
                            display_text: '📋 Copy JID',
                            copy_code: chatId
                        })
                    },
                    {
                        name: 'cta_copy',
                        buttonParamsJson: JSON.stringify({
                            display_text: '🔢 Copy ID',
                            copy_code: jidNum
                        })
                    }
                ]
            }, { quoted: msg });

        } catch (error) {
            console.error('Error in getchanelid command:', error);
            await extra.reply('❌ Failed to get chat ID.');
        }
    }
};
