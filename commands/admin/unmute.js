/**
 * Unmute Command
 *
 * .unmute @user  — removes a user's mute so their messages stop being deleted
 * .unmute        — (no mention) reopens the group so all members can talk
 */

const database = require('../../database');

module.exports = {
    name: 'unmute',
    aliases: ['unsilence', 'opengroup'],
    category: 'admin',
    description: 'Unmute a user or reopen the group',
    usage: '.unmute @user  OR  .unmute  (opens group)',
    groupOnly: true,
    adminOnly: true,
    botAdminNeeded: true,

    async execute(sock, msg, args, extra) {
        const jid = extra.from;
        try {
            const ctx       = msg.message?.extendedTextMessage?.contextInfo;
            const mentioned = ctx?.mentionedJid || [];
            const quoted    = ctx?.participant && ctx.stanzaId ? ctx.participant : null;
            const target    = mentioned[0] || quoted;

            // ── No target → open whole group ─────────────────────────────────
            if (!target) {
                await sock.groupSettingUpdate(jid, 'not_announcement');
                return extra.reply('🔓 *Group Opened*\n\nAll members can send messages again.');
            }

            // ── Unmute specific user ──────────────────────────────────────────
            const removed = database.unmuteUser(jid, target);
            const num     = target.split('@')[0];

            if (!removed) {
                return extra.reply(`ℹ️ @${num} is not muted.`);
            }

            await sock.sendMessage(jid, {
                text:
                    `🔊 *User Unmuted*\n\n` +
                    `👤 @${num} has been unmuted.\n` +
                    `✅ Their messages will no longer be deleted.`,
                mentions: [target]
            }, { quoted: msg });

        } catch (err) {
            console.error('[unmute] error:', err);
            await extra.reply(`❌ Error: ${err.message}`);
        }
    }
};
