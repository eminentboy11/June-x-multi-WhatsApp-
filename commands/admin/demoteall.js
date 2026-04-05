/**
 * Demote All Command
 * Demotes all admins in the group except the bot and the group creator.
 * The bot always keeps its admin status.
 */

module.exports = {
    name: 'demoteall',
    aliases: ['removeadmins', 'demoteadmins'],
    category: 'admin',
    description: 'Demote all admins in the group (bot and creator are protected)',
    usage: '.demoteall',
    groupOnly: true,
    adminOnly: true,
    botAdminNeeded: true,

    async execute(sock, msg, args, extra) {
        const chatId = extra.from;

        try {
            const metadata     = await sock.groupMetadata(chatId);
            const participants = metadata.participants || [];

            // Extract bare phone number from any JID format:
            // "254798952793:12@s.whatsapp.net"  → "254798952793"
            // "254798952793@s.whatsapp.net"     → "254798952793"
            // "254798952793@lid"                → "254798952793"
            const bareNum = (jid = '') => jid.split('@')[0].split(':')[0];

            const botJid = sock.user?.id || '';
            const botNum = bareNum(botJid);

            // Group creator — usually metadata.owner; fall back to metadata.creator
            const creatorJid = metadata.owner || metadata.creator || '';
            const creatorNum = bareNum(creatorJid);

            const isSafe = (p) => {
                const num = bareNum(p.id);
                if (num === botNum)     return true;   // never demote the bot
                if (num === creatorNum && creatorNum) return true; // never demote creator
                if (p.admin === 'superadmin') return true; // extra guard for creator role
                return false;
            };

            // Only target regular admins — protected members are excluded
            let toDemote = participants
                .filter(p => p.admin === 'admin' && !isSafe(p))
                .map(p => p.id);

            // Final safety net — strip bot JID in case anything slipped through
            toDemote = toDemote.filter(jid => bareNum(jid) !== botNum);

            if (toDemote.length === 0) {
                return extra.reply('ℹ️ No admins to demote — bot and group creator are protected.');
            }

            // Demote everyone in one call
            await sock.groupParticipantsUpdate(chatId, toDemote, 'demote');

            const text =
                `✅ *Demote All Complete*\n\n` +
                `👤 *Demoted (${toDemote.length}):*\n` +
                toDemote.map(j => `• @${bareNum(j)}`).join('\n');

            await sock.sendMessage(chatId, { text, mentions: toDemote }, { quoted: msg });

        } catch (error) {
            console.error('[demoteall] Error:', error);
            await extra.reply(`❌ Error: ${error.message}`);
        }
    }
};
