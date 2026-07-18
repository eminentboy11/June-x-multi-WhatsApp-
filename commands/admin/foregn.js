/**
 * ╔════════════════════════════════════════════════════════╗
 * ║  FILE    : antiforeign.js                              ║
 * ║  FEATURE : AntiForeign — block non-local numbers       ║
 * ║  SCOPE   : Admin — Group only                          ║
 * ╚════════════════════════════════════════════════════════╝
 *
 * Usage:
 *   .antiforeign                   — scan group, list all non-254 numbers
 *   .antiforeign <code>            — scan group, list all non-<code> numbers
 *   .antiforeign <code> on         — enable auto-kick on join
 *   .antiforeign <code> kick       — immediately kick all non-<code> members
 *   .antiforeign kick              — kick using stored allowed code
 *   .antiforeign off               — disable auto-kick
 *   .antiforeign status            — show current setting
 */

const path = require('path');
const { jidDecode } = require('@whiskeysockets/baileys');
const database = require(require('path').join(global.__CORE__, 'database'));
const { resolvePhone, preloadLidResolution } = require(path.join(global.__ROOT__, 'utils', 'jidHelper'));

// Strip leading + and whitespace, return digits only
function normaliseCode(raw) {
    return String(raw).replace(/^\+/, '').trim();
}

// Returns true if a resolved phone number is NOT from allowedCode
function isForeignPhone(phone, allowedCode) {
    return !String(phone).startsWith(allowedCode);
}

// Enrich participants: resolve real phone number, mark LID, keep original JID for API calls
async function enrichParticipants(sock, participants, botJid) {
    const botPhone = (await resolvePhone(sock, botJid)) || (botJid || '').split('@')[0].split(':')[0];

    const resolved = await Promise.all(participants.map(async p => {
        // Baileys v7 already includes phoneNumber on LID participants from groupMetadata()
        let phone = null;
        if (p.phoneNumber) {
            const dec = jidDecode(p.phoneNumber);
            phone = dec?.user?.split(':')[0] || String(p.phoneNumber).split('@')[0].split(':')[0];
        }
        // Fallback to full LID resolution if phoneNumber wasn't in the metadata
        if (!phone) phone = await resolvePhone(sock, p.id);
        return { ...p, phone, isUnresolvableLid: !phone };
    }));

    return resolved.filter(p => {
        const pNum = p.phone || p.id.split('@')[0].split(':')[0];
        if (pNum === botPhone) return false;   // never flag the bot
        if (p.admin)           return false;   // never flag admins
        return true;
    });
}

// Return { foreign, unresolved } — foreign = confirmed non-local, unresolved = couldn't verify
async function getForeignParticipants(sock, participants, allowedCode, botJid) {
    const enriched = await enrichParticipants(sock, participants, botJid);
    const unresolved = enriched.filter(p => p.isUnresolvableLid);
    const foreign = enriched.filter(p => !p.isUnresolvableLid && isForeignPhone(p.phone, allowedCode));
    return { foreign, unresolved };
}

module.exports = {
    name: 'antiforeign',
    aliases: ['foregn', 'foreignprotect', 'foreigners'],
    category: 'admin',
    description: 'Scan/remove members whose number doesn\'t match the allowed country code',
    usage: '.antiforeign [code] [on|kick|off]',
    groupOnly: true,
    adminOnly: true,
    botAdminNeeded: true,

    async execute(sock, msg, args, extra) {
        const { from, reply } = extra;
        const gs         = database.getGroupSettings(from);
        const storedCode = gs.antiforegnCode || '254';
        const isEnabled  = !!gs.antiforeign;

        const first  = (args[0] || '').toLowerCase().replace(/^\+/, '');
        const second = (args[1] || '').toLowerCase();

        // ── No args: scan with stored/default code ───────────────────────────
        if (!first) {
            return this._scan(sock, from, storedCode, reply);
        }

        // ── status ───────────────────────────────────────────────────────────
        if (first === 'status') {
            return reply(
                `🌍 *AntiForeign*\n\n` +
                `Status: ${isEnabled ? `✅ ON  (allowed: *+${storedCode}*)` : '❌ OFF'}\n\n` +
                `*.antiforeign 254 on* — enable auto-kick on join\n` +
                `*.antiforeign 254 kick* — remove all non-254 now\n` +
                `*.antiforeign 254* — scan only (no action)\n` +
                `*.antiforeign off* — disable`
            );
        }

        // ── off ──────────────────────────────────────────────────────────────
        if (first === 'off') {
            database.updateGroupSettings(from, { antiforeign: false });
            return reply('🌍 *AntiForeign* turned ❌ *OFF*.\nForeign members can now join freely.');
        }

        // ── kick (no code — use stored code) ─────────────────────────────────
        if (first === 'kick') {
            if (!isEnabled || !gs.antiforegnCode) {
                return reply(
                    '❌ AntiForeign is not enabled. Enable it first:\n' +
                    '*.antiforeign 254 on*\n\n' +
                    'Or kick directly without enabling:\n' +
                    '*.antiforeign 254 kick*'
                );
            }
            return this._kick(sock, from, storedCode, reply);
        }

        // ── <code> must be digits only ────────────────────────────────────────
        const code = normaliseCode(first);
        if (!/^\d+$/.test(code)) {
            return reply(
                '❌ Invalid country code.\n\n' +
                'Usage:\n' +
                '`.antiforeign 254` — scan only\n' +
                '`.antiforeign 254 on` — enable auto-kick\n' +
                '`.antiforeign 254 kick` — remove all non-254 now'
            );
        }

        // .antiforeign <code> on
        if (second === 'on') {
            database.updateGroupSettings(from, { antiforeign: true, antiforegnCode: code });
            return reply(
                `🌍 *AntiForeign ON* ✅\n\n` +
                `Allowed country code: *+${code}*\n` +
                `Members joining without *+${code}* will be auto-kicked.\n\n` +
                `_Run_ *.antiforeign ${code} kick* _to purge existing foreign members._`
            );
        }

        // .antiforeign <code> kick
        if (second === 'kick') {
            return this._kick(sock, from, code, reply);
        }

        // .antiforeign <code> off
        if (second === 'off') {
            database.updateGroupSettings(from, { antiforeign: false });
            return reply('🌍 *AntiForeign* turned ❌ *OFF*.');
        }

        // .antiforeign <code>  — scan only, no action
        return this._scan(sock, from, code, reply);
    },

    // ── Scan: list foreign members with real phone numbers ───────────────────
    async _scan(sock, groupJid, code, reply) {
        try {
            const meta = await sock.groupMetadata(groupJid);

            await reply('⏳ Resolving member numbers, this can take a few seconds…');
            await preloadLidResolution(sock, meta.participants || []);

            const { foreign, unresolved } = await getForeignParticipants(
                sock, meta.participants || [], code, sock.user?.id
            );

            const unresolvedNote = unresolved.length
                ? `\n\n_(${unresolved.length} member(s) couldn't be verified yet — their LID hasn't resolved to a number)_`
                : '';

            if (!foreign.length) {
                return reply(
                    `✅ *AntiForeign Scan — +${code}*\n\n` +
                    `No foreign members found.\n` +
                    `All verified non-admin members have *+${code}* numbers.` +
                    unresolvedNote
                );
            }

            const list = foreign.map((p, i) => `${i + 1}. +${p.phone}`).join('\n');

            return reply(
                `🌍 *AntiForeign Scan — +${code}*\n\n` +
                `Found *${foreign.length}* non-+${code} member(s):\n\n` +
                `${list}\n\n` +
                `_Run_ *.antiforeign ${code} kick* _to remove them._` +
                unresolvedNote
            );
        } catch (e) {
            console.error('[antiforeign scan]', e.message);
            return reply(`❌ Error scanning group: ${e.message}`);
        }
    },

    // ── Kick: remove all foreign members in batches ──────────────────────────
    async _kick(sock, groupJid, code, reply) {
        try {
            const meta = await sock.groupMetadata(groupJid);

            await preloadLidResolution(sock, meta.participants || []);

            const { foreign, unresolved } = await getForeignParticipants(
                sock, meta.participants || [], code, sock.user?.id
            );

            if (!foreign.length) {
                return reply(
                    `✅ *AntiForeign — +${code}*\n\n` +
                    `No foreign members found. Nothing to remove.` +
                    (unresolved.length ? `\n\n_(${unresolved.length} member(s) unverified — skipped)_` : '')
                );
            }

            await reply(`⏳ *AntiForeign* — removing *${foreign.length}* non-+${code} member(s)…`);

            // Use original p.id for the API call — Baileys accepts both PN and LID JIDs
            const jids = foreign.map(p => p.id);

            // Kick in batches of 5 with a short delay to avoid rate-limits
            for (let i = 0; i < jids.length; i += 5) {
                await sock.groupParticipantsUpdate(groupJid, jids.slice(i, i + 5), 'remove');
                if (i + 5 < jids.length) await new Promise(r => setTimeout(r, 1500));
            }

            await sock.sendMessage(groupJid, {
                text:
                    `🌍 *AntiForeign:* Removed *${jids.length}* member(s) ` +
                    `whose numbers don't match *+${code}*.`,
            });
        } catch (e) {
            console.error('[antiforeign kick]', e.message);
            await reply(`❌ Error during removal: ${e.message}`);
        }
    },

    // ── Called on every group-join event from handler.js ─────────────────────
    async handleGroupJoin(sock, groupJid, participantJid) {
        const gs = database.getGroupSettings(groupJid);
        if (!gs.antiforeign || !gs.antiforegnCode) return;

        // Give a joining member's LID a brief window to resolve before giving up
        let phone = await resolvePhone(sock, participantJid);
        if (!phone) {
            try { await sock.presenceSubscribe(participantJid); } catch (_) { /* ignore */ }
            for (let i = 0; i < 3 && !phone; i++) {
                await new Promise(r => setTimeout(r, 1000));
                phone = await resolvePhone(sock, participantJid);
            }
        }
        if (!phone) return; // still unresolved — don't kick blindly

        if (isForeignPhone(phone, gs.antiforegnCode)) {
            try {
                await sock.groupParticipantsUpdate(groupJid, [participantJid], 'remove');
                await sock.sendMessage(groupJid, {
                    text:
                        `🌍 *AntiForeign:* Removed *+${phone}* ` +
                        `— number does not match allowed code *+${gs.antiforegnCode}*.`,
                    mentions: [participantJid],
                });
            } catch (e) {
                console.error('[antiforeign join-kick]', e.message);
            }
        }
    },
};
