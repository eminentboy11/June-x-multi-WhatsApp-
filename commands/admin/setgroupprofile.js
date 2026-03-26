/**
 * Set Group Profile - Update the group's profile picture
 */

const { downloadMediaMessage } = require('@whiskeysockets/baileys');

module.exports = {
    name: 'setgroupprofile',
    aliases: ['sgp', 'setgrouppp', 'setgrouppic'],
    category: 'admin',
    description: "Set the group's profile picture",
    usage: '.setgroupprofile (send or reply to an image)',
    groupOnly: true,
    adminOnly: true,
    botAdminNeeded: true,

    async execute(sock, msg, args, extra) {
        const chatId = extra.from;

        try {
            let imageMessage = null;

            // Check if image is directly attached to this message
            if (msg.message?.imageMessage) {
                imageMessage = msg;
            }

            // Check if image is in a quoted/replied message
            if (!imageMessage) {
                const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                if (quoted?.imageMessage) {
                    imageMessage = {
                        key: {
                            remoteJid: chatId,
                            fromMe: false,
                            id: msg.message.extendedTextMessage.contextInfo.stanzaId,
                            participant: msg.message.extendedTextMessage.contextInfo.participant
                        },
                        message: quoted
                    };
                }
            }

            if (!imageMessage) {
                return extra.reply('❌ Please send an image or reply to an image with this command.');
            }

            await sock.sendMessage(chatId, { react: { text: '🖼️', key: msg.key } });

            const buffer = await downloadMediaMessage(imageMessage, 'buffer', {}, { logger: undefined });

            await sock.updateProfilePicture(chatId, buffer);

            await extra.reply('✅ Group profile picture updated successfully!');

        } catch (error) {
            console.error('setgroupprofile error:', error);
            if (error.message?.includes('not-authorized') || error.output?.statusCode === 401) {
                return extra.reply('❌ I do not have permission to change the group picture.');
            }
            extra.reply('❌ Failed to update group profile picture.');
        }
    }
};
