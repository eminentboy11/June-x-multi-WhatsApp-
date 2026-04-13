/**
 * Mute Command
 *
 * .mute @user   — silences a specific user (bot deletes their messages automatically)
 * .mute         — (no mention) locks the entire group so only admins can talk
 */

const database = require('../../database');

module.exports = {
    name: 'mute',
    aliases: ['silence', 'closegroup'],
    category: 'admin',
    description: 'Mute a user (auto-deletes their messages) or lock the whole group',
    usage: '.mute @user  OR  .mute  (locks group)',
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

            // ── No target → lock whole group ─────────────────────────────────
            if (!target) {
                await sock.groupSettingUpdate(jid, 'announcement');
                return extra.reply('🔒 *Group Locked*\n\nOnly admins can send messages now.\nUse `.unmute` to reopen.');
            }

            // ── Validate target ───────────────────────────────────────────────
            const botId = sock.user?.id ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : null;
            if (botId && (target === botId || target === sock.user?.id)) {
                return extra.reply('🤖 I cannot mute myself!');
            }

            const isTargetAdmin = extra.groupMetadata?.participants?.some(
                p => (p.id === target || p.lid === target) &&
                     (p.admin === 'admin' || p.admin === 'superadmin')
            );
            if (isTargetAdmin) {
                return extra.reply('❌ Cannot mute a group admin!');
            }

            // ── Mute the user ─────────────────────────────────────────────────
            database.muteUser(jid, target);
            database.clearWarnings(jid, target);   // wipe their warns too

            const num = target.split('@')[0];
            await sock.sendMessage(jid, {
                text:
                    `🔇 *User Muted*\n\n` +
                    `👤 @${num} has been muted.\n` +
                    `🗑️ Their messages will be automatically deleted.\n` +
                    `⚠️ Their warnings have been cleared.\n\n` +
                    `_Use .unmute @user to restore their access._`,
                mentions: [target]
            }, { quoted: msg });

        } catch (err) {
            console.error('[mute] error:', err);
            await extra.reply(`❌ Error: ${err.message}`);
        }
    }
};
