/**
 * WaMe Command — extract a number from a quoted message and build a wa.me link
 *
 * Sources checked in order:
 *   1. Quoted message sender JID (participant)
 *   2. Phone number found in the quoted message text
 *   3. Phone number in the current message args (fallback: .wame 254712345678)
 */

module.exports = {
    name: 'wame',
    aliases: ['walink', 'whatslink', 'openwa'],
    category: 'utility',
    description: 'Generate a wa.me link from a quoted message or a number',
    usage: '.wame  (reply to a message)  OR  .wame <number>',

    async execute(sock, msg, args, extra) {
        try {
            let rawNumber = null;
            let source    = null;

            const ctx    = msg.message?.extendedTextMessage?.contextInfo;
            const quoted = ctx?.quotedMessage;

            // ── 1. Quoted message sender JID ──────────────────────────────────
            if (quoted && ctx?.participant) {
                rawNumber = ctx.participant.split('@')[0].replace(/[^0-9]/g, '');
                source    = 'quoted sender';
            }

            // ── 2. Phone number inside quoted message text ────────────────────
            if (!rawNumber && quoted) {
                const quotedText =
                    quoted.conversation ||
                    quoted.extendedTextMessage?.text ||
                    quoted.imageMessage?.caption ||
                    quoted.videoMessage?.caption ||
                    quoted.documentMessage?.caption || '';

                const match = quotedText.match(/\+?(\d[\d\s\-().]{6,}\d)/);
                if (match) {
                    rawNumber = match[1].replace(/\D/g, '');
                    source    = 'text in quoted message';
                }
            }

            // ── 3. Args fallback: .wame 254712345678 ─────────────────────────
            if (!rawNumber && args.length > 0) {
                rawNumber = args.join('').replace(/\D/g, '');
                source    = 'provided number';
            }

            // ── Nothing found ─────────────────────────────────────────────────
            if (!rawNumber || rawNumber.length < 7) {
                return extra.reply(
                    '❌ No phone number found.\n\n' +
                    '*Usage:*\n' +
                    '• Reply to any message → `.wame`\n' +
                    '• Direct number → `.wame 254712345678`'
                );
            }

            const link = `https://wa.me/${rawNumber}`;

            await sock.sendMessage(extra.from, {
                text:
                    `🔗 *WhatsApp Link*\n\n` +
                    `📞 *Number:* +${rawNumber}\n` +
                    `🌐 *Link:* ${link}\n\n` +
                    `_Source: ${source}_`,
            }, { quoted: msg });

        } catch (err) {
            console.error('[wame] error:', err);
            await extra.reply(`❌ Error: ${err.message}`);
        }
    }
};
