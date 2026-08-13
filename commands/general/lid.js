/**
 * LID — resolve phone ↔ Linked Identity JID (Baileys 7 dual-identity).
 *
 * .lid
 * .lid @user
 * .lid 2348072642047
 * .lid 233256100331525@lid
 * reply + .lid
 */

const { jidDecode } = require('@whiskeysockets/baileys');
const {
    jidUser,
    getLidMappingValue,
    rememberLidMapping,
    rememberParticipantLidMapping,
    resolvePhone,
} = require('../../utils/jidHelper');

function isLidJid(value) {
    try {
        const server = jidDecode(String(value || ''))?.server;
        return server === 'lid' || server === 'hosted.lid';
    } catch (_) {
        return false;
    }
}

function isPnJid(value) {
    try {
        const server = jidDecode(String(value || ''))?.server;
        return server === 's.whatsapp.net' || server === 'hosted' || server === 'c.us';
    } catch (_) {
        return false;
    }
}

function asPnJid(value) {
    const user = jidUser(value);
    return user ? `${user}@s.whatsapp.net` : null;
}

function asLidJid(value) {
    const user = jidUser(value);
    return user ? `${user}@lid` : null;
}

function collectInput(msg, args, extra) {
    const ctx =
        msg.message?.extendedTextMessage?.contextInfo ||
        msg.message?.imageMessage?.contextInfo ||
        msg.message?.videoMessage?.contextInfo ||
        null;

    const mentioned = ctx?.mentionedJid?.[0];
    if (mentioned) {
        return {
            raw: mentioned,
            lid: isLidJid(mentioned) ? mentioned : null,
            pn: isPnJid(mentioned) ? mentioned : null,
            hint: 'mention',
        };
    }

    if (ctx?.participant || ctx?.participantAlt) {
        return {
            raw: ctx.participantAlt || ctx.participant,
            lid: isLidJid(ctx.participant) ? ctx.participant : (isLidJid(ctx.participantAlt) ? ctx.participantAlt : null),
            pn: isPnJid(ctx.participantAlt) ? ctx.participantAlt : (isPnJid(ctx.participant) ? ctx.participant : null),
            hint: 'quoted',
        };
    }

    const raw = (args || []).join(' ').trim();
    if (raw) {
        if (raw.includes('@lid') || raw.includes('@hosted.lid')) {
            return { raw, lid: raw.includes('@') ? raw : asLidJid(raw), pn: null, hint: 'arg-lid' };
        }
        if (raw.includes('@s.whatsapp.net') || raw.includes('@hosted')) {
            return { raw, lid: null, pn: raw, hint: 'arg-pn' };
        }
        const digits = raw.replace(/\D/g, '');
        if (digits.length >= 14) {
            // LID users are long opaque ids; phone numbers are typically 7–15 digits
            return { raw, lid: `${digits}@lid`, pn: null, hint: 'arg-lid' };
        }
        if (digits.length >= 7 && digits.length <= 15) {
            return { raw, lid: null, pn: `${digits}@s.whatsapp.net`, hint: 'arg-pn' };
        }
        return { raw, lid: null, pn: null, hint: 'arg-unknown' };
    }

    // No target: resolve the sender, or the DM peer
    const sender = extra.sender;
    const peer = extra.isGroup ? sender : extra.from;
    return {
        raw: peer,
        lid: isLidJid(peer) ? peer : (isLidJid(msg.key?.participant) ? msg.key.participant : (isLidJid(msg.key?.remoteJid) ? msg.key.remoteJid : null)),
        pn: isPnJid(peer) ? peer : (msg.key?.participantAlt || msg.key?.remoteJidAlt || null),
        hint: extra.isGroup ? 'sender' : 'chat',
    };
}

function findParticipant(meta, jid) {
    if (!meta?.participants || !jid) return null;
    const user = jidUser(jid);
    return meta.participants.find(p => {
        if (!p || typeof p === 'string') return false;
        const ids = [p.id, p.lid, p.userJid, p.phoneNumber, p.pn].filter(Boolean);
        return ids.includes(jid) || ids.some(id => jidUser(id) === user);
    }) || null;
}

async function resolvePair(sock, extra, input) {
    const map = sock.signalRepository?.lidMapping;
    let lid = input.lid || null;
    let pn = input.pn && isPnJid(input.pn) ? input.pn : (input.pn ? asPnJid(input.pn) : null);
    const sources = [];

    const participant = findParticipant(extra.groupMetadata, lid || pn || input.raw);
    if (participant) {
        rememberParticipantLidMapping(participant);
        if (!lid && (participant.lid || isLidJid(participant.id))) {
            lid = participant.lid || participant.id;
            sources.push('group');
        }
        if (!pn && (participant.phoneNumber || participant.pn || isPnJid(participant.id))) {
            const phone = participant.phoneNumber || participant.pn || participant.id;
            pn = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;
            sources.push('group');
        }
    }

    if (lid && !pn) {
        try {
            if (map?.getPNForLID) {
                const live = await map.getPNForLID(lid);
                if (live) {
                    pn = isPnJid(live) ? live : asPnJid(live);
                    sources.push('baileys');
                }
            }
        } catch (_) {}
        if (!pn) {
            const cached = getLidMappingValue(jidUser(lid), 'lidToPn');
            if (cached) {
                pn = asPnJid(cached);
                sources.push('sqlite');
            }
        }
        if (!pn) {
            const phone = await resolvePhone(sock, lid);
            if (phone) {
                pn = asPnJid(phone);
                sources.push('helper');
            }
        }
    }

    if (pn && !lid) {
        try {
            if (map?.getLIDForPN) {
                const live = await map.getLIDForPN(pn);
                if (live) {
                    lid = isLidJid(live) ? live : asLidJid(live);
                    sources.push('baileys');
                }
            }
        } catch (_) {}
        if (!lid) {
            try {
                if (map?.getLIDsForPNs) {
                    const rows = await map.getLIDsForPNs([pn]);
                    const first = Array.isArray(rows) ? rows[0] : null;
                    const live = first?.lid || null;
                    if (live) {
                        lid = isLidJid(live) ? live : asLidJid(live);
                        sources.push('baileys');
                    }
                }
            } catch (_) {}
        }
        if (!lid) {
            const cached = getLidMappingValue(jidUser(pn), 'pnToLid');
            if (cached) {
                lid = asLidJid(cached);
                sources.push('sqlite');
            }
        }
    }

    if (lid && pn) rememberLidMapping(lid, pn);

    return { lid, pn, sources: [...new Set(sources)] };
}

module.exports = {
    name: 'lid',
    aliases: ['lidinfo', 'pn2lid', 'resolve'],
    category: 'general',
    description: 'Resolve WhatsApp phone number ↔ LID',
    usage: '.lid [@user | number | reply]',

    async execute(sock, msg, args, extra) {
        const input = collectInput(msg, args, extra);

        if (input.hint === 'arg-unknown') {
            return extra.reply(
                `🆔 *LID Resolver*\n\n` +
                `Could not parse: *${input.raw}*\n\n` +
                `Usage:\n` +
                `  .lid\n` +
                `  .lid @user\n` +
                `  .lid 2348072642047\n` +
                `  .lid 233256100331525@lid\n` +
                `  .lid  _(reply to a message)_`
            );
        }

        try {
            if (extra.react) await extra.react('🆔').catch(() => {});
            const pair = await resolvePair(sock, extra, input);

            const lines = [
                `┏━━『 LID MAP 』━━`,
                ``,
                `➥ Target    ➜ ${input.raw}`,
                `➥ Phone     ➜ ${pair.pn || 'not cached'}`,
                `➥ LID       ➜ ${pair.lid || 'not cached'}`,
                `➥ Source    ➜ ${pair.sources.length ? pair.sources.join(' · ') : 'none'}`,
                ``,
                `┗━━━━━━━━━━━━━━━━`,
            ];

            if (!pair.pn && pair.lid) {
                lines.splice(lines.length - 2, 0, `_PN is only known after WhatsApp has seen this user._`);
            }

            if (extra.react) await extra.react(pair.pn || pair.lid ? '✅' : '⚠️').catch(() => {});
            await extra.reply(lines.join('\n'));
        } catch (error) {
            console.error('[lid]', error.message);
            if (extra.react) await extra.react('❌').catch(() => {});
            await extra.reply(`❌ LID lookup failed: ${error.message}`);
        }
    },
};
