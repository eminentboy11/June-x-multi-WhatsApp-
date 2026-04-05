/**
 * Demote All Command
 * Demotes all admins in the group (except the bot and the group creator) in one call
 */

module.exports = {
    name: 'demoteall',
    aliases: ['removeadmins', 'demoteadmins'],
    category: 'admin',
    description: 'Demote all admins in the group (except bot and group creator)',
    usage: '.demoteall',
    groupOnly: true,
    adminOnly: true,
    botAdminNeeded: true,

    async execute(sock, msg, args, extra) {
        const chatId = extra.from;

        try {
            const metadata    = await sock.groupMetadata(chatId);
            const participants = metadata.participants || [];

            // Resolve bot number (strips device suffix)
            const botJid = sock.user?.id || '';
            const botNum = botJid.includes(':')
                ? botJid.split(':')[0]
                : botJid.split('@')[0];

            const isBot = (jid) => {
                const num = jid.split(':')[0].split('@')[0];
                return num === botNum || jid === botJid;
            };

            // Group creator JID
            const creatorJid = metadata.owner || metadata.creator;

            const isCreator = (jid) => {
                if (!creatorJid) return false;
                return jid === creatorJid ||
                       jid.split('@')[0] === creatorJid.split('@')[0];
            };

            // Collect all regular admins — skip bot and creator
            const toDemote = participants
                .filter(p => p.admin === 'admin' && !isBot(p.id) && !isCreator(p.id))
                .map(p => p.id);

            if (toDemote.length === 0) {
                return extra.reply('ℹ️ No regular admins to demote (creator and bot are protected).');
            }

            // Single call — demote everyone at once
            await sock.groupParticipantsUpdate(chatId, toDemote, 'demote');

            const text = `✅ *Demote All Complete*\n\n` +
                         `👤 *Demoted (${toDemote.length}):*\n` +
                         toDemote.map(j => `• @${j.split('@')[0]}`).join('\n');

            await sock.sendMessage(chatId, { text, mentions: toDemote }, { quoted: msg });

        } catch (error) {
            console.error('[demoteall] Error:', error);
            await extra.reply(`❌ Error: ${error.message}`);
        }
    }
};
