const database = require('../../database');
const config = require('../../config');
const { resolvePhone } = require('../../utils/jidHelper');

async function resolveToPhone(sock, jid) {
    const phone = await resolvePhone(sock, jid);
    return phone ? String(phone).replace(/\D/g, '') : null;
}

module.exports = {
    name: 'removesudo',
    aliases: ['delsudo', 'removemod', 'delmod'],
    category: 'owner',
    description: 'Remove a sudo (moderator) user, or all at once',
    usage: '.removesudo @user | number | all',
    ownerOnly: true,

    async execute(sock, msg, args, extra) {
        const { from, reply, react } = extra;

        // â”€â”€ removesudo all â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        if (args[0]?.toLowerCase() === 'all') {
            const mods = database.getModerators();
            if (!mods || mods.length === 0) {
                return reply(` There are no sudo users to remove.`);
            }
            for (const num of mods) {
                database.removeModerator(num);
            }
            await react('🤥');
            return reply(`¸ *All sudo users removed.*\n\n*Cleared:* ${mods.length} user${mods.length !== 1 ? 's' : ''}`);
        }

        // â”€â”€ removesudo @user / number â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.participant;

        let targetJid = mentioned[0] || quoted || null;

        if (!targetJid && args[0]) {
            const num = args[0].replace(/\D/g, '');
            if (num.length >= 7) targetJid = `${num}@s.whatsapp.net`;
        }

        if (!targetJid) {
            return reply(
                `âŒ *Usage:*\n` +
                `  ${config.prefix}removesudo @user\n` +
                `  ${config.prefix}removesudo 254712345678\n` +
                `  ${config.prefix}removesudo all ” remove every sudo user`
            );
        }

        let number = await resolveToPhone(sock, targetJid);

        if (!number) {
            const rawLid = targetJid.split('@')[0].split(':')[0];
            return reply(` Could not resolve LID @${rawLid} to a phone number.\n\nTry using the phone number directly:\n${config.prefix}removesudo 254712345678`);
        }

        if (!database.isModerator(number)) {
            return sock.sendMessage(from, {
                text: ` @${number} is not a sudo user.`,
                mentions: [`${number}@s.whatsapp.net`]
            }, { quoted: msg });
        }

        database.removeModerator(number);
        await react('🚫');
        const mentionJid = `${number}@s.whatsapp.net`;
        await sock.sendMessage(from, {
            text: `*@${number}* has been removed from sudo users.`,
            mentions: [mentionJid]
        }, { quoted: msg });
    }
};
