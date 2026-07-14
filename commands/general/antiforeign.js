/**
 * ╔════════════════════════════════════════════════════════╗
 * ║  FILE    : antiforeign.js                              ║
 * ║  FEATURE : AntiForeign — block non-local numbers       ║
 * ║  SCOPE   : Admin — Group only                          ║
 * ║  CMDS    : see usage below                             ║
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

const database = require(require('path').join(global.__CORE__, 'database'));

// Strip leading + and whitespace, return digits only
function normaliseCode(raw) {
    return String(raw).replace(/^\+/, '').trim();
}

// Returns true if this participant's number does NOT start with allowedCode
function isForeign(jid, allowedCode) {
    const phone = jid.split('@')[0].split(':')[0];
    return !phone.startsWith(allowedCode);
}

// Return all non-admin, non-bot participants whose number is foreign
function getForeignParticipants(participants, allowedCode, botJid) {
    const botPhone = (botJid || '').split('@')[0].split(':')[0];
    return participants.filter(p => {
        const phone = p.id.split('@')[0].split(':')[0];
        if (phone === botPhone) return false;   // never flag the bot itself
        if (p.admin)            return false;   // never flag admins/co-admins
        return !phone.startsWith(allowedCode);
    });
}

module.exports = {
    name: 'antiforeign',
    aliases: ['antiforegn', 'foreignprotect', 'antiforeigners'],
    category: 'admin',
    description: 'Scan/remove members whose number doesn\'t match the allowed country code',
    usage: '.antiforeign [code] [on|kick|off]',
    groupOnly: true,
    adminOnly: true,
    botAdminNeeded: true,

    async execute(sock, msg, args, extra) {
        const { from, reply } = extra;
        const gs          = database.getGroupSettings(from);
        const storedCode  = gs.antiforegnCode || '254';
        const isEnabled   = !!gs.antiforeign;

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
                `*.antiforeign 254 on* — enable auto-kick\n` +
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

    // ── Scan: list foreign members, no action ────────────────────────────────
    async _scan(sock, groupJid, code, reply) {
        try {
            const meta    = await sock.groupMetadata(groupJid);
            const foreign = getForeignParticipants(meta.participants || [], code, sock.user?.id);

            if (!foreign.length) {
                return reply(
                    `✅ *AntiForeign Scan — +${code}*\n\n` +
                    `No foreign members found.\n` +
                    `All non-admin members have *+${code}* numbers.`
                );
            }

            const list = foreign.map((p, i) => {
                const phone = p.id.split('@')[0].split(':')[0];
                return `${i + 1}. +${phone}`;
            }).join('\n');

            return reply(
                `🌍 *AntiForeign Scan — +${code}*\n\n` +
                `Found *${foreign.length}* non-+${code} member(s):\n\n` +
                `${list}\n\n` +
                `_Run_ *.antiforeign ${code} kick* _to remove them._`
            );
        } catch (e) {
            console.error('[antiforeign scan]', e.message);
            return reply(`❌ Error scanning group: ${e.message}`);
        }
    },

    // ── Kick: remove all foreign members in batches ──────────────────────────
    async _kick(sock, groupJid, code, reply) {
        try {
            const meta    = await sock.groupMetadata(groupJid);
            const foreign = getForeignParticipants(meta.participants || [], code, sock.user?.id);

            if (!foreign.length) {
                return reply(
                    `✅ *AntiForeign — +${code}*\n\n` +
                    `No foreign members found. Nothing to remove.`
                );
            }

            await reply(`⏳ *AntiForeign* — removing *${foreign.length}* non-+${code} member(s)…`);

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

        if (isForeign(participantJid, gs.antiforegnCode)) {
            try {
                await sock.groupParticipantsUpdate(groupJid, [participantJid], 'remove');
                await sock.sendMessage(groupJid, {
                    text:
                        `🌍 *AntiForeign:* Removed @${participantJid.split('@')[0]} ` +
                        `— number does not match allowed code *+${gs.antiforegnCode}*.`,
                    mentions: [participantJid],
                });
            } catch (e) {
                console.error('[antiforeign join-kick]', e.message);
            }
        }
    },
};
