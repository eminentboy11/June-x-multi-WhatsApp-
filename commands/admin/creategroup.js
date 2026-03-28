/**
 * Create Group Command
 * Creates a new WhatsApp group with mentioned members
 * Owner/Sudo only to prevent abuse
 */

module.exports = {
    name: 'creategroup',
    aliases: ['newgroup', 'mkgroup'],
    category: 'admin',
    description: 'Create a new WhatsApp group with mentioned members',
    usage: '.creategroup <group name> @user1 @user2 ...',
    ownerOnly: true,

    async execute(sock, msg, args, extra) {
        try {
            const ctx = msg.message?.extendedTextMessage?.contextInfo;
            const mentioned = ctx?.mentionedJid || [];

            // Separate the group name from the args
            // Name is everything before the first @mention in the raw text
            const rawText = msg.message?.conversation ||
                msg.message?.extendedTextMessage?.text || '';

            const nameMatch = rawText.replace(/^[.!/#\\]?\w+\s*/, '').replace(/@\d+/g, '').trim();
            const groupName = nameMatch || args.filter(a => !a.startsWith('@')).join(' ').trim();

            if (!groupName) return extra.reply(
                '❌ Please provide a group name.\n' +
                'Usage: `.creategroup My Group @user1 @user2`'
            );

            if (mentioned.length === 0) return extra.reply(
                '❌ Mention at least one member to add.\n' +
                'Usage: `.creategroup My Group @user1 @user2`'
            );

            await sock.sendMessage(extra.from, { react: { text: '⏳', key: msg.key } });

            // Create the group
            const result = await sock.groupCreate(groupName, mentioned);

            const groupId = result.id || result.gid
            const memberList = mentioned.map(jid => `• @${jid.split('@')[0]}`).join('\n');

            let text = `✅ *Group Created Successfully!*\n\n`;
            text += `👥 *Name:* ${groupName}\n`;
            text += `🔗 *ID:* ${groupId}\n`;
            text += `👤 *Members Added (${mentioned.length}):*\n${memberList}`;

            await sock.sendMessage(extra.from, {
                text,
                mentions: mentioned
            }, { quoted: msg });

            await sock.sendMessage(extra.from, { react: { text: '✅', key: msg.key } });

        } catch (error) {
            console.error('CreateGroup error:', error);
            await sock.sendMessage(extra.from, { react: { text: '❌', key: msg.key } });

            let errMsg = '❌ Failed to create group: ' + error.message;
            if (error.message?.includes('not-authorized')) {
                errMsg = '❌ Not authorized to create groups. Make sure the bot has permission.';
            } else if (error.message?.includes('bad-jid')) {
                errMsg = '❌ One or more mentioned numbers are invalid or not on WhatsApp.';
            }
            await extra.reply(errMsg);
        }
    }
};
