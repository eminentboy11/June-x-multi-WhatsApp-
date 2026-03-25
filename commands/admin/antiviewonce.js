const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const database = require('../../database');

/**
 * Detects and re-sends view-once messages in groups where antiviewonce is enabled.
 * Called from handler.js for every group message.
 */
async function handleAntiviewonce(sock, msg) {
    try {
        if (!msg?.key || !msg.message) return false;
        const from = msg.key.remoteJid;
        if (!from.endsWith('@g.us')) return false;

        const gs = database.getGroupSettings(from);
        if (!gs.antiviewonce) return false;

        const rawMsg = msg.message;

        // Locate the view-once wrapper in the message
        const voWrappers = [
            'viewOnceMessageV2Extension',
            'viewOnceMessageV2',
            'viewOnceMessage',
        ];

        let innerMsg = null;
        for (const wrapper of voWrappers) {
            if (rawMsg[wrapper]?.message) {
                innerMsg = rawMsg[wrapper].message;
                break;
            }
        }

        // Also check direct media with viewOnce flag
        if (!innerMsg) {
            if (rawMsg.imageMessage?.viewOnce) {
                innerMsg = { imageMessage: { ...rawMsg.imageMessage, viewOnce: false } };
            } else if (rawMsg.videoMessage?.viewOnce) {
                innerMsg = { videoMessage: { ...rawMsg.videoMessage, viewOnce: false } };
            } else if (rawMsg.audioMessage?.viewOnce) {
                innerMsg = { audioMessage: { ...rawMsg.audioMessage, viewOnce: false } };
            }
        }

        if (!innerMsg) return false;

        const mtype = Object.keys(innerMsg)[0];
        const mediaTypes = { imageMessage: 'image', videoMessage: 'video', audioMessage: 'audio' };
        const dlType = mediaTypes[mtype];
        if (!dlType) return false;

        const stream = await downloadContentFromMessage(innerMsg[mtype], dlType);
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        const buffer = Buffer.concat(chunks);

        const senderNum = (msg.key.participant || msg.key.remoteJid).split('@')[0].split(':')[0];
        const caption   = (innerMsg[mtype]?.caption || '') + `\n\n👁️ _View-once revealed · sent by @${senderNum}_`;

        if (dlType === 'image') {
            await sock.sendMessage(from, { image: buffer, caption, mentions: [msg.key.participant || msg.key.remoteJid] }, { quoted: msg });
        } else if (dlType === 'video') {
            await sock.sendMessage(from, { video: buffer, caption, mimetype: 'video/mp4', mentions: [msg.key.participant || msg.key.remoteJid] }, { quoted: msg });
        } else if (dlType === 'audio') {
            await sock.sendMessage(from, { audio: buffer, ptt: false, mimetype: 'audio/mp4' }, { quoted: msg });
        }

        return true;
    } catch (e) {
        console.error('[ANTIVIEWONCE] error:', e.message);
        return false;
    }
}

module.exports = {
    name: 'antiviewonce',
    aliases: ['antivo', 'noviewonce', 'revealvo'],
    category: 'admin',
    description: 'Auto-reveal view-once messages in groups',
    usage: '.antiviewonce on/off',
    groupOnly: true,
    adminOnly: true,

    handleAntiviewonce,

    async execute(sock, msg, args, extra) {
        const { from, reply } = extra;
        const sub = (args[0] || '').toLowerCase();
        const gs  = database.getGroupSettings(from);

        if (!sub) {
            return reply(
                `👁️ *Anti View-Once*\n` +
                `━━━━━━━━━━━━━━━\n` +
                `Status: *${gs.antiviewonce ? '✅ ON' : '❌ OFF'}*\n\n` +
                `When enabled, all view-once images, videos and audio sent in this group are automatically revealed.\n\n` +
                `  .antiviewonce on\n` +
                `  .antiviewonce off`
            );
        }

        if (sub === 'on') {
            database.updateGroupSettings(from, { antiviewonce: true });
            return reply('✅ *Anti View-Once* enabled — view-once media will be auto-revealed.');
        }

        if (sub === 'off') {
            database.updateGroupSettings(from, { antiviewonce: false });
            return reply('❌ *Anti View-Once* disabled.');
        }

        return reply('⚠️ Usage: .antiviewonce on/off');
    }
};
