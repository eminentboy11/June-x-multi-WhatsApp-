/**
 * Pin / Unpin Commands
 */

// ── Shared helpers ────────────────────────────────────────────────────────────

const react = (sock, msg, emoji) =>
    sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } });

const send = (sock, msg, text) =>
    sock.sendMessage(msg.key.remoteJid, { text }, { quoted: msg });

// ── Extract quoted message key ────────────────────────────────────────────────

function getQuotedKey(msg, jid) {
    const ctx =
        msg.message?.extendedTextMessage?.contextInfo ||
        msg.message?.imageMessage?.contextInfo ||
        msg.message?.videoMessage?.contextInfo ||
        msg.message?.audioMessage?.contextInfo ||
        msg.message?.documentMessage?.contextInfo ||
        null;

    if (!ctx?.stanzaId) return null;

    return {
        id: ctx.stanzaId,
        remoteJid: jid,
        fromMe: ctx.participant === undefined,
        participant: ctx.participant || undefined,
    };
}

// ── Commands ──────────────────────────────────────────────────────────────────

module.exports = [

    {
        name: 'pin',
        aliases: ['pinchat'],
        category: 'utility',
        description: 'Pin the current chat',
        usage: '.pin',

        async execute(sock, msg, args, extra) {
            const jid = extra.from;

            await react(sock, msg, '📌');

            try {
                await sock.chatModify({ pin: true }, jid);

                await send(sock, msg,
                    '📌 *Chat Pinned*\n\n' +
                    'This chat has been pinned successfully.\n\n' +
                    '_Use_ *.unpin* _to unpin this chat._'
                );

                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[pin]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Failed to pin chat. Please try again.');
            }
        },
    },

    {
        name: 'unpin',
        aliases: ['unpinchat'],
        category: 'utility',
        description: 'Unpin the current chat',
        usage: '.unpin',

        async execute(sock, msg, args, extra) {
            const jid = extra.from;

            await react(sock, msg, '📌');

            try {
                await sock.chatModify({ pin: false }, jid);

                await send(sock, msg,
                    '📌 *Chat Unpinned*\n\n' +
                    'This chat has been unpinned successfully.\n\n' +
                    '_Use_ *.pin* _to pin this chat again._'
                );

                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[unpin]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Failed to unpin chat. Please try again.');
            }
        },
    },

    {
        name: 'pinmsg',
        aliases: ['pinmessage'],
        category: 'utility',
        description: 'Pin a quoted message in a chat or group',
        usage: '.pinmsg (reply to a message)',

        async execute(sock, msg, args, extra) {
            const jid = extra.from;
            const duration = args[0];

            // ── Duration options ──────────────────────────────────────────────
            const durations = {
                '24h':  86400,       // 1 day
                '7d':   604800,      // 7 days
                '30d':  2592000,     // 30 days
            };

            const pinTime = durations[duration] || 604800; // default 7 days

            // ── Check quoted message ──────────────────────────────────────────
            const quotedKey = getQuotedKey(msg, jid);

            if (!quotedKey) {
                return extra.reply(
                    '❌ *Please reply to a message to pin it.*\n\n' +
                    '*Usage:* .pinmsg\n' +
                    '*Duration options:*\n' +
                    '  .pinmsg 24h  → Pin for 24 hours\n' +
                    '  .pinmsg 7d   → Pin for 7 days _(default)_\n' +
                    '  .pinmsg 30d  → Pin for 30 days'
                );
            }

            await react(sock, msg, '📌');

            try {
                await sock.sendMessage(jid, {
                    pin: {
                        type: 1,
                        time: pinTime,
                        key: quotedKey,
                    },
                });

                const label =
                    duration === '24h' ? '24 hours' :
                    duration === '30d' ? '30 days' :
                    '7 days';

                await send(sock, msg,
                    `📌 *Message Pinned*\n\n` +
                    `Duration: *${label}*\n\n` +
                    '_Use_ *.unpinmsg* _(reply same message) to unpin._'
                );

                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[pinmsg]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Failed to pin message. Make sure the bot is an admin in groups.');
            }
        },
    },

    {
        name: 'unpinmsg',
        aliases: ['unpinmessage'],
        category: 'utility',
        description: 'Unpin a quoted message in a chat or group',
        usage: '.unpinmsg (reply to a pinned message)',

        async execute(sock, msg, args, extra) {
            const jid = extra.from;

            // ── Check quoted message ──────────────────────────────────────────
            const quotedKey = getQuotedKey(msg, jid);

            if (!quotedKey) {
                return extra.reply(
                    '❌ *Please reply to the pinned message to unpin it.*\n\n' +
                    '*Usage:* .unpinmsg _(reply to the pinned message)_'
                );
            }

            await react(sock, msg, '📌');

            try {
                await sock.sendMessage(jid, {
                    pin: {
                        type: 2,
                        time: 0,
                        key: quotedKey,
                    },
                });

                await send(sock, msg,
                    '📌 *Message Unpinned*\n\n' +
                    'The message has been unpinned successfully.\n\n' +
                    '_Use_ *.pinmsg* _(reply to a message) to pin again._'
                );

                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[unpinmsg]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Failed to unpin message. Make sure the bot is an admin in groups.');
            }
        },
    },

];
