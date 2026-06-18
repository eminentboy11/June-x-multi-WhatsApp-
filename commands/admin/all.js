/**
 * All — Tag all group members.
 *
 * Triggers:
 *   .all [message]   — prefix command
 *   @all [message]   — inline trigger (handled by handler.js body check)
 *
 * Rules:
 *   - Group only
 *   - Only admins or the bot owner can trigger it
 *   - If used with a quoted message, forwards the quoted content with all mentions
 */

module.exports = {
    name: 'all',
    aliases: ['tag-all', 'alltag'],
    category: 'admin',
    description: 'Tag all members in the group',
    usage: '.all [message]  |  @all [message]',
    groupOnly: true,
    adminOnly: false,
    botAdminNeeded: false,

    async execute(sock, msg, args, extra) {
        try {
            const { from, groupMetadata, reply } = extra;

            const participants = (groupMetadata?.participants || []).map(p => p.id).filter(Boolean);
            if (!participants.length) return reply('⚠️ Could not fetch group members.');

            const customMsg = args.join(' ').trim();
            const divider   = '━━━━━━━━━━━━━━━━━━━━';

            // Build the mention list text
            const mentionLines = participants
                .map(jid => `@${jid.split('@')[0].split(':')[0]}`)
                .join('  ');

            // Check for a quoted message to forward
            const ctxInfo = msg.message?.extendedTextMessage?.contextInfo;
            const quotedMsg = ctxInfo?.quotedMessage;

            if (quotedMsg) {
                const quotedText =
                    quotedMsg.conversation ||
                    quotedMsg.extendedTextMessage?.text ||
                    quotedMsg.imageMessage?.caption ||
                    quotedMsg.videoMessage?.caption ||
                    '';

                const text =
                    `📢 *TAG ALL*\n${divider}\n` +
                    (customMsg ? `💬 ${customMsg}\n\n` : '') +
                    (quotedText ? `📝 ${quotedText}\n\n` : '') +
                    `${divider}\n${mentionLines}`;

                await sock.sendMessage(from, { text, mentions: participants }, { quoted: msg });
                return;
            }

            const text =
                `📢 *TAG ALL*\n${divider}\n` +
                (customMsg ? `💬 ${customMsg}\n\n` : '') +
                `${divider}\n${mentionLines}`;

            await sock.sendMessage(from, { text, mentions: participants }, { quoted: msg });

        } catch (err) {
            console.error('[ALL] error:', err.message);
            await extra.reply('❌ Failed to tag all members.');
        }
    }
};
