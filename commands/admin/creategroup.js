/**
 * Create Group Command
 * Creates a new WhatsApp group with mentioned members OR plain phone numbers.
 * Usage:
 *   .creategroup My Group @user1 @user2
 *   .creategroup June Ultra 254798570132, 254792021944
 *   .creategroup Cool Squad @user1 254712345678
 */

// Normalise a raw phone number string → "number@s.whatsapp.net"
// Strips spaces, dashes, parentheses, leading + sign, trailing commas.
function phoneToJid(raw) {
    const digits = raw.replace(/[\s\-().+,]/g, '').replace(/^0+/, '');
    if (!digits || digits.length < 7) return null;
    return `${digits}@s.whatsapp.net`;
}

// Return true if a token looks like a phone number (mostly digits, may have + or -)
function looksLikePhone(token) {
    return /^[+\d][\d\s\-().]{5,}[,]?$/.test(token);
}

module.exports = {
    name: 'creategroup',
    aliases: ['newgroup', 'mkgroup'],
    category: 'admin',
    description: 'Create a new WhatsApp group with mentioned members or phone numbers',
    usage: '.creategroup <group name> @user1 @user2\n.creategroup <group name> 2547xxxxxxxx, 2547xxxxxxxx',
    ownerOnly: true,

    async execute(sock, msg, args, extra) {
        try {
            const ctx = msg.message?.extendedTextMessage?.contextInfo;

            // ── Collect members from @mentions ────────────────────────────────
            const members = new Set(ctx?.mentionedJid || []);

            // ── Collect members from plain phone numbers in args ──────────────
            // Also build the "name" tokens = args that aren't phone numbers or @-tags
            const nameTokens = [];
            for (const token of args) {
                // Strip trailing comma to test
                const clean = token.replace(/,+$/, '').trim();
                if (!clean) continue;

                if (looksLikePhone(clean)) {
                    const jid = phoneToJid(clean);
                    if (jid) members.add(jid);
                } else if (/^@/.test(token)) {
                    // @mention token — already in mentionedJid, skip for name
                } else {
                    nameTokens.push(token);
                }
            }

            const groupName = nameTokens.join(' ').trim();

            if (!groupName) {
                return extra.reply(
                    '❌ Please provide a group name.\n\n' +
                    'Examples:\n' +
                    '• `.creategroup My Group @user1 @user2`\n' +
                    '• `.creategroup June Ultra 254798570132, 254792021944`'
                );
            }

            if (members.size === 0) {
                return extra.reply(
                    '❌ Add at least one member — mention them with @ or provide their phone number.\n\n' +
                    'Examples:\n' +
                    '• `.creategroup My Group @user1 @user2`\n' +
                    '• `.creategroup June Ultra 254798570132, 254792021944`'
                );
            }

            await sock.sendMessage(extra.from, { react: { text: '⏳', key: msg.key } });

            const memberList = [...members];
            const result = await sock.groupCreate(groupName, memberList);

            const groupId   = result.id || result.gid;
            const memberStr = memberList.map(jid => `• @${jid.split('@')[0]}`).join('\n');

            let text = `✅ *Group Created Successfully!*\n\n`;
            text += `👥 *Name:* ${groupName}\n`;
            text += `🔗 *ID:* ${groupId}\n`;
            text += `👤 *Members Added (${memberList.length}):*\n${memberStr}`;

            await sock.sendMessage(extra.from, { text, mentions: memberList }, { quoted: msg });
            await sock.sendMessage(extra.from, { react: { text: '✅', key: msg.key } });

        } catch (error) {
            console.error('CreateGroup error:', error);
            await sock.sendMessage(extra.from, { react: { text: '❌', key: msg.key } });

            let errMsg = '❌ Failed to create group: ' + error.message;
            if (error.message?.includes('not-authorized')) {
                errMsg = '❌ Not authorized to create groups.';
            } else if (error.message?.includes('bad-jid')) {
                errMsg = '❌ One or more numbers are invalid or not on WhatsApp.';
            }
            await extra.reply(errMsg);
        }
    }
};
