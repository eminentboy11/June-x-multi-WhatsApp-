/**
 * Quoted Info Command
 * Get detailed information about a quoted/replied message
 */

module.exports = {
    name: 'q',
    aliases: ['quote', 'quotedinfo'],
    category: 'tools',
    description: 'Get detailed information about a quoted message',
    usage: '.q (reply to any message)',

    async execute(sock, msg, args, extra) {
        try {
            const ctx = msg.message?.extendedTextMessage?.contextInfo;
            if (!ctx?.quotedMessage) return extra.reply('❌ Reply to the message you want to inspect.');

            const quotedType = Object.keys(ctx.quotedMessage)[0] || 'unknown';
            const qm = ctx.quotedMessage;

            const messageData = {
                type: quotedType,
                sender: ctx.participant || ctx.remoteJid || 'unknown',
                chat: extra.from,
                stanzaId: ctx.stanzaId || '',
                text: qm?.conversation || qm?.extendedTextMessage?.text || '',
                caption: qm?.imageMessage?.caption || qm?.videoMessage?.caption || qm?.documentMessage?.caption || '',
                mimetype: qm?.imageMessage?.mimetype || qm?.videoMessage?.mimetype || qm?.audioMessage?.mimetype || qm?.documentMessage?.mimetype || '',
                fileName: qm?.documentMessage?.fileName || '',
                isForwarded: qm?.[quotedType]?.isForwarded || false,
                forwardingScore: qm?.[quotedType]?.forwardingScore || 0,
                hasMedia: ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'].includes(quotedType)
            };

            await sock.sendMessage(extra.from, {
                text: `📋 *Quoted Message Info*\n\n\`\`\`json\n${JSON.stringify(messageData, null, 2)}\n\`\`\``
            }, { quoted: msg });

        } catch (error) {
            console.error('[QUOTEDINFO ERROR]', error);
            await extra.reply('❌ Failed to fetch quoted message information.');
        }
    }
};
