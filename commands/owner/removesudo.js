const database = require('../../database');
const config = require('../../config');

function resolveToPhone(jid) {
    if (!jid) return null;
    const raw = jid.split('@')[0].split(':')[0];
    if (jid.includes('@lid')) {
        const fs = require('fs');
        const path = require('path');
        const sessionPath = path.join(__dirname, '../../', config.sessionName || 'session');
        const revFile = path.join(sessionPath, `lid-mapping-${raw}_reverse.json`);
        if (fs.existsSync(revFile)) {
            try {
                const pn = JSON.parse(fs.readFileSync(revFile, 'utf8').trim());
                if (pn) return String(pn);
            } catch (_) {}
        }
        return null;
    }
    return raw;
}

module.exports = {
    name: 'removesudo',
    aliases: ['delsudo', 'removemod', 'delmod'],
    category: 'owner',
    description: 'Remove a sudo (moderator) user',
    usage: '.removesudo @user or .removesudo number',
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
            return reply(`❌ *Usage:* ${config.prefix}removesudo @user or ${config.prefix}removesudo 254712345678`);
        }

        let number = resolveToPhone(targetJid);

        if (!number) {
            const rawLid = targetJid.split('@')[0].split(':')[0];
            return reply(`❌ Could not resolve LID @${rawLid} to a phone number.\n\nTry using the phone number directly:\n${config.prefix}removesudo 254712345678`);
        }

        if (!database.isModerator(number)) {
            return sock.sendMessage(from, {
                text: `⚠️ @${number} is not a sudo user.`,
                mentions: [`${number}@s.whatsapp.net`]
            }, { quoted: msg });
        }

        database.removeModerator(number);
        await react('✅');
        const mentionJid = `${number}@s.whatsapp.net`;
        await sock.sendMessage(from, {
            text: `🗑️ *@${number}* has been removed from sudo users.`,
            mentions: [mentionJid]
        }, { quoted: msg });
    }
};
