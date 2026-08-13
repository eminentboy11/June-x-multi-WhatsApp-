const database = require('../../database');
const config = require('../../config');
const { resolvePhone } = require('../../utils/jidHelper');

async function resolveToPhone(sock, jid) {
    const phone = await resolvePhone(sock, jid);
    return phone ? String(phone).replace(/\D/g, '') : null;
}

module.exports = {
    name: 'addsudo',
    aliases: ['addmod', 'setsudo'],
    category: 'owner',
    description: 'Add a sudo (moderator) user who can use owner-level commands',
    usage: '.addsudo @user or .addsudo number',
    ownerOnly: true,

    async execute(sock, msg, args, extra) {
        const { from, reply, react } = extra;

        const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.participant;

        let targetJid = mentioned[0] || quoted || null;

        if (!targetJid && args[0]) {
            const num = args[0].replace(/\D/g, '');
            if (num.length >= 7) targetJid = `${num}@s.whatsapp.net`;
        }

        if (!targetJid) {
            return reply(`❌ *Usage:* ${config.prefix}addsudo @user or ${config.prefix}addsudo 254712345678`);
        }

        let number = await resolveToPhone(sock, targetJid);

        if (!number) {
            const rawLid = targetJid.split('@')[0].split(':')[0];
            return reply(`❌ Could not resolve LID @${rawLid} to a phone number.\n\nTry using the phone number directly:\n${config.prefix}addsudo 254712345678`);
        }

        if (database.isModerator(number)) {
            return sock.sendMessage(from, {
                text: `⚠️ @${number} is already a sudo user.`,
                mentions: [`${number}@s.whatsapp.net`]
            }, { quoted: msg });
        }

        database.addModerator(number);
        await react('✅');
        const mentionJid = `${number}@s.whatsapp.net`;
        await sock.sendMessage(from, {
            text: `✅ *@${number}* has been added as a sudo user.\n\nThey can now use moderator-level commands.`,
            mentions: [mentionJid]
        }, { quoted: msg });
    }
};
