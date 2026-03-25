/**
 * AntiViewOnce — auto-reveals view-once images/videos/audio in groups.
 *
 * Baileys v7 view-once message structures (any combination):
 *   msg.message.viewOnceMessageV2Extension.message.<type>Message
 *   msg.message.viewOnceMessageV2.message.<type>Message
 *   msg.message.viewOnceMessage.message.<type>Message
 *   msg.message.ephemeralMessage.message.viewOnceMessageV2.message.<type>Message
 *   msg.message.<type>Message.viewOnce === true   (rare direct flag)
 */

const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const database = require('../../database');

// All known viewOnce wrappers, in priority order
const VO_WRAPPERS = [
    'viewOnceMessageV2Extension',
    'viewOnceMessageV2',
    'viewOnceMessage',
];

const MEDIA_DL_TYPES = {
    imageMessage:    'image',
    videoMessage:    'video',
    audioMessage:    'audio',
};

/**
 * Tries to extract the inner media message from any viewOnce wrapper.
 * Returns { innerMsg, mtype, dlType } or null.
 */
function extractViewOnce(rawMsg) {
    // Also unwrap ephemeral layer first
    const layers = [rawMsg];
    if (rawMsg.ephemeralMessage?.message) layers.push(rawMsg.ephemeralMessage.message);

    for (const layer of layers) {
        // Check wrappers
        for (const wrapper of VO_WRAPPERS) {
            const inner = layer[wrapper]?.message;
            if (inner) {
                const mtype = Object.keys(inner).find(k => MEDIA_DL_TYPES[k]);
                if (mtype) return { innerMsg: inner, mtype, dlType: MEDIA_DL_TYPES[mtype] };
            }
        }
        // Direct viewOnce flag on media
        for (const [mtype, dlType] of Object.entries(MEDIA_DL_TYPES)) {
            if (layer[mtype]?.viewOnce === true) {
                return { innerMsg: { [mtype]: { ...layer[mtype], viewOnce: false } }, mtype, dlType };
            }
        }
    }
    return null;
}

/**
 * Called from handler.js for every group message.
 * Downloads and re-sends view-once media when antiviewonce is enabled.
 */
async function handleAntiviewonce(sock, msg) {
    try {
        if (!msg?.key || !msg.message) return false;
        const from = msg.key.remoteJid;
        if (!from.endsWith('@g.us')) return false;

        const gs = database.getGroupSettings(from);
        if (!gs.antiviewonce) return false;

        const result = extractViewOnce(msg.message);
        if (!result) return false;

        const { innerMsg, mtype, dlType } = result;

        // Download
        const stream = await downloadContentFromMessage(innerMsg[mtype], dlType);
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        const buffer = Buffer.concat(chunks);

        const senderJid = msg.key.participant || msg.key.remoteJid;
        const senderNum = senderJid.split('@')[0].split(':')[0];
        const caption   =
            (innerMsg[mtype]?.caption ? innerMsg[mtype].caption + '\n\n' : '') +
            `👁️ _View-once revealed · sent by @${senderNum}_`;

        if (dlType === 'image') {
            await sock.sendMessage(
                from,
                { image: buffer, caption, mentions: [senderJid] },
                { quoted: msg }
            );
        } else if (dlType === 'video') {
            await sock.sendMessage(
                from,
                { video: buffer, caption, mimetype: 'video/mp4', mentions: [senderJid] },
                { quoted: msg }
            );
        } else if (dlType === 'audio') {
            await sock.sendMessage(
                from,
                { audio: buffer, ptt: false, mimetype: 'audio/mp4' },
                { quoted: msg }
            );
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
            return reply('✅ *Anti View-Once* enabled — view-once media will be auto-revealed in this group.');
        }

        if (sub === 'off') {
            database.updateGroupSettings(from, { antiviewonce: false });
            return reply('❌ *Anti View-Once* disabled.');
        }

        return reply('⚠️ Usage: .antiviewonce on/off');
    }
};
