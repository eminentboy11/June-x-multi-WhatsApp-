/**
 * Revoke Link — sock.groupRevokeInvite
 * Kills the current invite and returns the new code.
 */

module.exports = {
    name: 'revokelink',
    aliases: ['resetlink', 'revoke', 'newlink'],
    category: 'admin',
    description: 'Reset the group invite link (old links stop working)',
    usage: '.revokelink',
    groupOnly: true,
    adminOnly: true,
    botAdminNeeded: true,

    async execute(sock, msg, args, extra) {
        try {
            if (extra.react) await extra.react('🔁').catch(() => {});

            const code = await sock.groupRevokeInvite(extra.from);
            if (!code) throw new Error('WhatsApp did not return a new invite code.');

            const link = `https://chat.whatsapp.com/${code}`;
            const name = extra.groupMetadata?.subject || 'this group';

            if (extra.react) await extra.react('✅').catch(() => {});
            await extra.reply(
                `🔁 *Invite link reset*\n\n` +
                `Group: *${name}*\n` +
                `New link:\n${link}\n\n` +
                `⚠️ Every old link for this group is now dead.`
            );
        } catch (error) {
            console.error('[revokelink]', error.message);
            if (extra.react) await extra.react('❌').catch(() => {});
            const denied = /not-authorized|401|403|forbidden/i.test(error.message || '');
            await extra.reply(
                denied
                    ? '❌ I cannot reset the link. Make sure the bot is an admin.'
                    : `❌ Failed to reset link: ${error.message}`
            );
        }
    },
};
