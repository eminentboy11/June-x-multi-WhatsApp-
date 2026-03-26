/**
 * Delete Command - Delete messages from any user (owner only, no restrictions)
 */

module.exports = {
    name: 'delete',
    aliases: ['del', 'delmsg'],
    category: 'owner',
    description: 'Delete messages from a replied user or mentioned user',
    usage: '.delete [count] (reply to or mention a user)',
    ownerOnly: true,

    async execute(sock, msg, args, extra) {
        const chatId = extra.from;

        try {
            const text = msg.message?.conversation ||
                         msg.message?.extendedTextMessage?.text || '';
            const parts = text.trim().split(/\s+/);

            // Parse optional count argument (default 1, max 50)
            let countArg = 1;
            if (parts.length > 1) {
                const maybeNum = parseInt(parts[1], 10);
                if (!isNaN(maybeNum) && maybeNum > 0) countArg = Math.min(maybeNum, 50);
            }

            const ctxInfo = msg.message?.extendedTextMessage?.contextInfo || {};
            const mentioned = Array.isArray(ctxInfo.mentionedJid) && ctxInfo.mentionedJid.length > 0
                ? ctxInfo.mentionedJid[0]
                : null;
            const repliedParticipant = ctxInfo.participant || null;

            let targetUser = null;
            let repliedMsgId = null;

            if (repliedParticipant && ctxInfo.stanzaId) {
                targetUser = repliedParticipant;
                repliedMsgId = ctxInfo.stanzaId;
            } else if (mentioned) {
                targetUser = mentioned;
            } else {
                targetUser = chatId.endsWith('@g.us') ? null : chatId;
            }

            if (!targetUser) {
                return await sock.sendMessage(chatId, {
                    text: '⚠️ Please reply to a message or mention a user to delete their recent messages.'
                }, { quoted: msg });
            }

            // Get messages from the bot's in-memory store
            const storeMap = sock.botStore?.messages?.get(chatId);
            const chatMessages = storeMap ? [...storeMap.values()] : [];

            const toDelete = [];
            const seenIds = new Set();

            // Always delete the command message itself
            if (msg.key?.id) {
                toDelete.push({ key: { ...msg.key } });
                seenIds.add(msg.key.id);
            }

            // Handle the replied message
            if (repliedMsgId) {
                const repliedInStore = chatMessages.find(
                    m => m.key.id === repliedMsgId &&
                         (m.key.participant || m.key.remoteJid) === targetUser
                );

                if (repliedInStore && !seenIds.has(repliedInStore.key.id)) {
                    toDelete.push(repliedInStore);
                    seenIds.add(repliedInStore.key.id);
                } else {
                    // Not in store — delete directly by key
                    try {
                        await sock.sendMessage(chatId, {
                            delete: {
                                remoteJid: chatId,
                                fromMe: false,
                                id: repliedMsgId,
                                participant: repliedParticipant
                            }
                        });
                        countArg = Math.max(0, countArg - 1);
                    } catch {}
                }
            }

            // Collect additional messages from target user in store
            for (let i = chatMessages.length - 1; i >= 0 && toDelete.length < countArg + 1; i--) {
                const m = chatMessages[i];
                const participant = m.key.participant || m.key.remoteJid;
                if (participant === targetUser && !seenIds.has(m.key.id)) {
                    if (!m.message?.protocolMessage) {
                        toDelete.push(m);
                        seenIds.add(m.key.id);
                    }
                }
            }

            if (toDelete.length === 0) {
                return await sock.sendMessage(chatId, {
                    text: '⚠️ No recent messages found for that user.'
                }, { quoted: msg });
            }

            // Delete collected messages with a small delay between each
            for (const m of toDelete) {
                try {
                    const msgParticipant = m.key.participant || targetUser;
                    await sock.sendMessage(chatId, {
                        delete: {
                            remoteJid: chatId,
                            fromMe: false,
                            id: m.key.id,
                            participant: msgParticipant
                        }
                    });
                    await new Promise(r => setTimeout(r, 300));
                } catch {}
            }

        } catch (err) {
            console.error('Delete command error:', err);
            await sock.sendMessage(chatId, {
                text: '❌ Failed to delete messages.'
            }, { quoted: msg });
        }
    }
};
