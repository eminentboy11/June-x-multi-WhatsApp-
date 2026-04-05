/**
 * Demote All Command
 * Demotes all admins in the group (except the bot and the group creator)
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
            const metadata     = await sock.groupMetadata(chatId);
            const participants = metadata.participants || [];

            // Resolve bot's JID
            const botJid = sock.user?.id || '';
            const botNum = botJid.split(':')[0].split('@')[0];

            const isBot = (p) => {
                const pNum = (p.id || '').split('@')[0].split(':')[0];
                return pNum === botNum;
            };

            // Only target regular admins — skip superadmin (group creator) and bot itself
            const todemote = participants.filter(p =>
                p.admin === 'admin' && !isBot(p)
            );

            if (todemote.length === 0) {
                return extra.reply('ℹ️ There are no admins to demote (group creator cannot be demoted).');
            }

            await extra.reply(`⏳ Demoting *${todemote.length}* admin(s)... Please wait.`);

            const failed  = [];
            const success = [];

            // Demote in chunks to avoid rate limits
            const chunkSize = 5;
            const jids = todemote.map(p => p.id);

            for (let i = 0; i < jids.length; i += chunkSize) {
                const chunk = jids.slice(i, i + chunkSize);
                try {
                    await sock.groupParticipantsUpdate(chatId, chunk, 'demote');
                    chunk.forEach(j => success.push(j));
                } catch (e) {
                    chunk.forEach(j => failed.push(j));
                }
                if (i + chunkSize < jids.length) {
                    await new Promise(r => setTimeout(r, 1500));
                }
            }

            // Build result message
            const mentions = success;
            let text = `✅ *Demote All Complete*\n\n`;

            if (success.length > 0) {
                text += `👤 *Demoted (${success.length}):*\n`;
                text += success.map(j => `• @${j.split('@')[0]}`).join('\n');
            }

            if (failed.length > 0) {
                text += `\n\n❌ *Failed (${failed.length}):*\n`;
                text += failed.map(j => `• @${j.split('@')[0]}`).join('\n');
            }

            await sock.sendMessage(chatId, { text, mentions }, { quoted: msg });

        } catch (error) {
            console.error('[demoteall] Error:', error);
            await extra.reply(`❌ Error: ${error.message}`);
        }
    }
};
