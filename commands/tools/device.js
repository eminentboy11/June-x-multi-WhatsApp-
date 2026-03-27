/**
 * Device Command - Detect what device a quoted message was sent from
 */

const { getDevice } = require('@whiskeysockets/baileys');

const DEVICE_LABELS = {
    android: 'Android',
    ios:     'iOS (iPhone/iPad)',
    web:     'WhatsApp Web',
    desktop: 'WhatsApp Desktop',
    unknown: 'Unknown'
};

module.exports = {
    name: 'getdevice',
    aliases: ['device', 'checkdevice'],
    category: 'tools',
    description: 'Detect what device a quoted message was sent from',
    usage: '.device (reply to any message)',

    async execute(sock, msg, args, extra) {
        const { from, reply } = extra;

        // Extract context from any message type that can quote
        const ctx =
            msg.message?.extendedTextMessage?.contextInfo ||
            msg.message?.imageMessage?.contextInfo ||
            msg.message?.videoMessage?.contextInfo ||
            msg.message?.audioMessage?.contextInfo ||
            msg.message?.stickerMessage?.contextInfo ||
            msg.message?.buttonsResponseMessage?.contextInfo ||
            msg.message?.listResponseMessage?.contextInfo;

        if (!ctx?.stanzaId) {
            return reply(` *Device Checker*\n\nReply to any message to detect what device it was sent from.`);
        }

        const messageId = ctx.stanzaId;
        const device    = getDevice(messageId);
        const label     = DEVICE_LABELS[device] || `${device}`;

        return reply(`*Device Detected*\n\nThis message was sent from *${label}*`);
    }
};
