/**
 * Check WhatsApp — sock.onWhatsApp(...phones)
 * LIDs are not accepted by onWhatsApp in Baileys 7; we always query by phone.
 * After a hit, we try the live LID map and persist it to SQLite.
 */

const { jidUser, rememberLidMapping, getLidMappingValue } = require('../../utils/jidHelper');

const MAX_NUMBERS = 8;

function digitsOnly(value) {
    return String(value || '').replace(/\D/g, '');
}

function collectTargets(msg, args) {
    const found = [];
    const lids = [];
    const push = (raw, hint) => {
        if (!raw) return;
        if (String(raw).endsWith('@lid') || String(raw).endsWith('@hosted.lid')) {
            if (!lids.includes(String(raw))) lids.push(String(raw));
            return;
        }
        const digits = digitsOnly(raw);
        if (digits.length < 7 || digits.length > 15) return;
        if (found.some(item => item.digits === digits)) return;
        found.push({ digits, hint: hint || digits });
    };

    const ctx =
        msg.message?.extendedTextMessage?.contextInfo ||
        msg.message?.imageMessage?.contextInfo ||
        msg.message?.videoMessage?.contextInfo ||
        null;

    for (const jid of ctx?.mentionedJid || []) push(jid, String(jid).split('@')[0]);

    // Reply: prefer the phone-number alt over a raw LID participant
    if (ctx?.participantAlt) push(ctx.participantAlt, 'quoted');
    if (ctx?.participant) push(ctx.participant, 'quoted');

    const blob = (args || []).join(' ');
    for (const chunk of blob.split(/[\s,;]+/)) {
        if (!chunk) continue;
        if (chunk.startsWith('@')) {
            push(chunk.slice(1), chunk);
            continue;
        }
        push(chunk, chunk);
    }

    return { found, lids };
}

async function resolveLidToPn(sock, extra, lid) {
    const phone = await resolvePhone(sock, lid);
    if (phone) return digitsOnly(phone);

    const participants = extra.groupMetadata?.participants || [];
    const user = jidUser(lid);
    const hit = participants.find(p => {
        if (!p || typeof p === 'string') return false;
        const ids = [p.id, p.lid, p.userJid].filter(Boolean);
        return ids.includes(lid) || ids.some(id => jidUser(id) === user);
    });
    if (hit) {
        rememberParticipantLidMapping(hit);
        const pn = hit.phoneNumber || hit.pn;
        if (pn) return digitsOnly(pn);
    }
    return null;
}

async function lookupLid(sock, pnJid) {
    const map = sock.signalRepository?.lidMapping;
    try {
        if (map?.getLIDForPN) {
            const lid = await map.getLIDForPN(pnJid);
            if (lid) return lid;
        }
    } catch (_) {}
    try {
        if (map?.getLIDsForPNs) {
            const rows = await map.getLIDsForPNs([pnJid]);
            const first = Array.isArray(rows) ? rows[0] : null;
            const lid = first?.lid || first?.[pnJid] || null;
            if (lid) return typeof lid === 'string' ? lid : null;
        }
    } catch (_) {}
    const cached = getLidMappingValue(jidUser(pnJid), 'pnToLid');
    return cached ? `${cached}@lid` : null;
}

module.exports = {
    name: 'checkwa',
    aliases: ['onwa', 'nowa', 'iswa', 'checknum'],
    category: 'general',
    description: 'Check if a number is registered on WhatsApp',
    usage: '.checkwa <number> [, number...]',

    async execute(sock, msg, args, extra) {
        const collected = collectTargets(msg, args);
        const targets = collected.found.slice();

        for (const lid of collected.lids) {
            const digits = await resolveLidToPn(sock, extra, lid);
            if (digits && !targets.some(item => item.digits === digits)) {
                targets.push({ digits, hint: lid });
            }
        }

        if (!targets.length) {
            const lidHint = collected.lids.length
                ? '\n\n_That mention is a LID and the phone number is not cached yet. Try the number itself._'
                : '';
            return extra.reply(
                `📱 *WhatsApp Check*\n\n` +
                `Usage:\n` +
                `  .checkwa 2348072642047\n` +
                `  .checkwa 234xxx, 254xxx\n` +
                `  .checkwa @user\n` +
                `  .checkwa  _(reply to a message)_\n\n` +
                `_Use the full country code. Max ${MAX_NUMBERS} numbers._` +
                lidHint
            );
        }

        const limited = targets.slice(0, MAX_NUMBERS);

        try {
            if (extra.react) await extra.react('🔎').catch(() => {});

            const queryIds = limited.map(t => `${t.digits}@s.whatsapp.net`);
            const results = await sock.onWhatsApp(...queryIds);
            const byUser = new Map();
            for (const row of results || []) {
                const user = jidUser(row?.jid) || digitsOnly(row?.jid);
                if (user) byUser.set(user, row);
            }

            const lines = ['┏━━『 WHATSAPP CHECK 』━━', ''];

            for (const target of limited) {
                const row = byUser.get(target.digits);
                const exists = !!row?.exists;
                const jid = row?.jid || `${target.digits}@s.whatsapp.net`;

                lines.push(`➥ ${target.digits}`);
                lines.push(`   Status  ➜ ${exists ? 'registered' : 'not on WhatsApp'}`);

                if (exists) {
                    lines.push(`   JID     ➜ ${jid}`);
                    const lid = await lookupLid(sock, jid);
                    if (lid) {
                        rememberLidMapping(lid, jid);
                        lines.push(`   LID     ➜ ${lid}`);
                    }
                }
                lines.push('');
            }

            lines.push('┗━━━━━━━━━━━━━━━━');
            if (extra.react) await extra.react('✅').catch(() => {});
            await extra.reply(lines.join('\n'));
        } catch (error) {
            console.error('[checkwa]', error.message);
            if (extra.react) await extra.react('❌').catch(() => {});
            await extra.reply(`❌ Check failed: ${error.message}`);
        }
    },
};
