/**
 * Set Group Description — sock.groupUpdateDescription
 * Admin + bot-admin.
 *   .setgdesc <text>
 *   .setgdesc          (reply to a message to use that text)
 *   .setgdesc clear    (remove the description)
 */

function getQuotedText(msg) {
    const ctx =
        msg.message?.extendedTextMessage?.contextInfo ||
        msg.message?.imageMessage?.contextInfo ||
        msg.message?.videoMessage?.contextInfo ||
        null;
    const quoted = ctx?.quotedMessage;
    if (!quoted) return '';
    return (
        quoted.conversation ||
        quoted.extendedTextMessage?.text ||
        quoted.imageMessage?.caption ||
        quoted.videoMessage?.caption ||
        quoted.documentMessage?.caption ||
        ''
    ).trim();
}

module.exports = {
    name: 'setgdesc',
    aliases: ['setdesc', 'setgroupdesc', 'setdescription'],
    category: 'admin',
    description: 'Change or clear the group description',
    usage: '.setgdesc <text> | .setgdesc clear | reply + .setgdesc',
    groupOnly: true,
    adminOnly: true,
    botAdminNeeded: true,

    async execute(sock, msg, args, extra) {
        const raw = (args || []).join(' ').trim();
        const quoted = getQuotedText(msg);
        const current = extra.groupMetadata?.desc?.trim() || '';
        const groupName = extra.groupMetadata?.subject || 'This group';

        const clear = ['clear', 'off', 'remove', 'delete', 'none'].includes(raw.toLowerCase());
        const next = clear ? '' : (raw || quoted);

        if (!next && !clear) {
            return extra.reply(
                `📝 *Group Description*\n\n` +
                `Group: *${groupName}*\n` +
                `Current:\n${current || '_No description set._'}\n\n` +
                `*Usage:*\n` +
                `  .setgdesc Welcome to the group\n` +
                `  .setgdesc   _(reply to a message)_\n` +
                `  .setgdesc clear`
            );
        }

        try {
            if (extra.react) await extra.react('✏️').catch(() => {});
            // Passing undefined deletes the description (Baileys rc14).
            await sock.groupUpdateDescription(extra.from, clear ? undefined : next);
            if (extra.react) await extra.react('✅').catch(() => {});

            if (clear) {
                return extra.reply('✅ Group description *removed*.');
            }
            await extra.reply(`✅ *Group description updated*\n\n${next}`);
        } catch (error) {
            console.error('[setgdesc]', error.message);
            if (extra.react) await extra.react('❌').catch(() => {});
            const denied = /not-authorized|401|403|forbidden/i.test(error.message || '');
            await extra.reply(
                denied
                    ? '❌ I do not have permission to change the description. Make sure the bot is admin and the group is not locked.'
                    : `❌ Failed to update description: ${error.message}`
            );
        }
    },
};
