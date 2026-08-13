/**
 * Set Group Name — sock.groupUpdateSubject
 * Admin + bot-admin. Subject is capped at 100 chars (WhatsApp limit).
 */

const MAX_SUBJECT = 100;

module.exports = {
    name: 'setgname',
    aliases: ['setsubject', 'setgroupname', 'gname'],
    category: 'admin',
    description: 'Change the group name',
    usage: '.setgname <new name>',
    groupOnly: true,
    adminOnly: true,
    botAdminNeeded: true,

    async execute(sock, msg, args, extra) {
        const current = extra.groupMetadata?.subject || 'this group';
        const name = (args || []).join(' ').trim();

        if (!name) {
            return extra.reply(
                `🏷️ *Group Name*\n\n` +
                `Current: *${current}*\n\n` +
                `Usage: .setgname <new name>\n` +
                `Example: .setgname June-X Hangout`
            );
        }

        if (name.length > MAX_SUBJECT) {
            return extra.reply(`❌ Group name is too long (${name.length}/${MAX_SUBJECT} characters).`);
        }

        try {
            if (extra.react) await extra.react('✏️').catch(() => {});
            await sock.groupUpdateSubject(extra.from, name);
            if (extra.react) await extra.react('✅').catch(() => {});
            await extra.reply(`✅ *Group name updated*\n\n${current}  →  *${name}*`);
        } catch (error) {
            console.error('[setgname]', error.message);
            if (extra.react) await extra.react('❌').catch(() => {});
            const denied = /not-authorized|401|403|forbidden/i.test(error.message || '');
            await extra.reply(
                denied
                    ? '❌ I do not have permission to change the group name. Make sure the bot is admin and the group is not locked.'
                    : `❌ Failed to update group name: ${error.message}`
            );
        }
    },
};
