/**
 * GetSW - Retrieve media from a status that tagged/mentioned the group
 */

const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

const SUPPORTED = ['imageMessage', 'videoMessage', 'audioMessage', 'extendedTextMessage', 'conversation'];

async function downloadMedia(contentNode, type) {
    const mediaType = type.replace('Message', '');
    const stream = await downloadContentFromMessage(contentNode, mediaType);
    let buf = Buffer.from([]);
    for await (const chunk of stream) buf = Buffer.concat([buf, chunk]);
    return buf;
}

/** Unwrap nested message layers (e.g. ephemeral, viewOnce wrappers) */
function deepUnwrap(message) {
    if (!message) return null;
    const wrappers = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'documentWithCaptionMessage'];
    for (const w of wrappers) {
        if (message[w]?.message) return deepUnwrap(message[w].message);
    }
    return message;
}

module.exports = {
    name: 'getsw',
    aliases: ['getstatusw', 'statusretrieve'],
    category: 'general',
    description: 'Retrieve media from a status that mentioned/tagged the group',
    usage: '.getsw (reply to the group tag notification)',
    ownerOnly: true,
    groupOnly: true,

    async execute(sock, msg, args, extra) {
        const { from, reply } = extra;

        // Must be a reply
        const ctx =
            msg.message?.extendedTextMessage?.contextInfo ||
            msg.message?.imageMessage?.contextInfo ||
            msg.message?.videoMessage?.contextInfo ||
            msg.message?.buttonsResponseMessage?.contextInfo ||
            msg.message?.listResponseMessage?.contextInfo;

        if (!ctx?.participant) {
            return reply(
                `❌ *REPLY TO NOTIFICATION MESSAGE!*\n\n` +
                `📋 *How to Use:*\n` +
                `1. Wait for someone to tag the group in their status\n` +
                `2. WhatsApp will send a notification to the group\n` +
                `3. Reply to that notification with *.getsw*\n\n` +
                `💡 *Example:*\n[Notification: "Status from user @ Group name"]\n└─ Reply: .getsw`
            );
        }

        if (!global.statusStore) {
            return reply(
                `❌ *STATUS STORE NOT ACTIVE!*\n\n` +
                `💡 No statuses have been cached since the bot started.\n` +
                `Ask the person to view their status again after the bot has been running.`
            );
        }

        const rawSender = ctx.participant;
        const senderNum = rawSender.replace(/[^0-9]/g, '');

        // Look up by exact JID first, fall back to phone number match
        let userStatuses = global.statusStore.get(rawSender) || [];
        if (userStatuses.length === 0) {
            for (const [key, val] of global.statusStore.entries()) {
                if (key.replace(/[^0-9]/g, '') === senderNum) { userStatuses = val; break; }
            }
        }

        if (userStatuses.length === 0) {
            return reply(
                `❌ *STATUS NOT FOUND IN STORE!*\n\n` +
                `👤 User: @${senderNum}\n\n` +
                `💡 The bot may have just restarted, or the status was posted before the bot came online.`,
                { mentions: [rawSender] }
            );
        }

        // Get latest status
        const latestMsg     = userStatuses[userStatuses.length - 1];
        const statusContent = deepUnwrap(latestMsg?.message);
        if (!statusContent) return reply('❌ Status content is empty!');

        const type = Object.keys(statusContent).find(k => SUPPORTED.includes(k));
        if (!type) {
            return reply(
                `❌ *STATUS TYPE NOT SUPPORTED!*\n\n` +
                `📋 Type: ${Object.keys(statusContent).join(', ')}\n\n` +
                `💡 Only supports: image, video, audio, text`
            );
        }

        await sock.sendMessage(from, { react: { text: '📥', key: msg.key } });

        try {
            const node    = statusContent[type];
            const caption = node?.caption || statusContent?.extendedTextMessage?.text ||
                            (typeof statusContent?.conversation === 'string' ? statusContent.conversation : '') || '';

            if (type === 'imageMessage') {
                const buf = await downloadMedia(node, type);
                await sock.sendMessage(from, {
                    image: buf,
                    caption: `✅ *STATUS RETRIEVED!*\n\n👤 From: @${senderNum}\n📷 Type: Image${caption ? `\n📝 Caption: ${caption}` : ''}`,
                    mentions: [rawSender]
                }, { quoted: msg });

            } else if (type === 'videoMessage') {
                const buf = await downloadMedia(node, type);
                await sock.sendMessage(from, {
                    video: buf,
                    caption: `✅ *STATUS RETRIEVED!*\n\n👤 From: @${senderNum}\n🎥 Type: Video${caption ? `\n📝 Caption: ${caption}` : ''}`,
                    mentions: [rawSender],
                    mimetype: 'video/mp4'
                }, { quoted: msg });

            } else if (type === 'audioMessage') {
                const buf = await downloadMedia(node, type);
                await sock.sendMessage(from, {
                    audio: buf,
                    mimetype: node.mimetype || 'audio/mp4',
                    ptt: node.ptt || false
                }, { quoted: msg });
                await reply(
                    `✅ *STATUS RETRIEVED!*\n\n👤 From: @${senderNum}\n🎤 Type: ${node.ptt ? 'Voice Note' : 'Audio'}`,
                    { mentions: [rawSender] }
                );

            } else {
                // Text
                await reply(
                    `✅ *STATUS RETRIEVED!*\n\n👤 From: @${senderNum}\n📝 Type: Text\n\n💬 Status:\n${caption || 'No text'}`,
                    { mentions: [rawSender] }
                );
            }

        } catch (err) {
            console.error('[GetSW] Error:', err);
            let msg2 = '❌ *FAILED TO RETRIEVE STATUS!*\n\n';
            if (err.message?.includes('not-authorized'))   msg2 += '🔒 Bot does not have access to this status.';
            else if (err.message?.includes('rate-overlimit')) msg2 += '⏱️ Too many requests. Wait a moment and try again.';
            else msg2 += `🔧 Error: ${err.message}`;
            await reply(msg2);
        }
    }
};
