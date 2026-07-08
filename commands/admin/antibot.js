/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║  FILE    : antibot.js                                    ║
 * ║  FEATURE : AntiBot — Auto-kick bot accounts              ║
 * ║  SCOPE   : Admin — Group Only                            ║
 * ║  CMDS    : .antibot on/off/status/action                 ║
 * ║  FIXED   : Baileys 7.0.0-rc13 compatible                 ║
 * ║  DETECT  : JID server type + name patterns               ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * Bot detection strategy (rc13):
 *   1. JID server type — @hosted.lid / @hosted = WhatsApp API agent/bot (most reliable)
 *   2. JID server type — @lid accounts that resolve to hosted agents
 *   3. Name patterns  — fallback for bots using regular JIDs (keyword match)
 *   4. fetchStatus    — optional secondary check; handled safely (rc13 returns array)
 */

const database = require(require('path').join(global.__CORE__, 'database'));
const config   = require(require('path').join(global.__ROOT__, 'config'));

// ── Name-pattern detection (fallback for regular JIDs) ───────────────────────
const BOT_PATTERNS = [
    /\bbot\b/i, /\bai\b/i, /assistant/i, /automat/i, /robot/i,
    /\bscript\b/i, /spambot/i, /floodbot/i, /chatbot/i, /userbot/i,
];

// Own bot name is never kicked
const WHITELIST_PATTERNS = [/junex/i, /june[\s\-_]?x/i, /june[\s\-_]?ultra/i];

const isWhitelisted = (name) => !!name && WHITELIST_PATTERNS.some(p => p.test(name));
const isBotName    = (name) => !!name && !isWhitelisted(name) && BOT_PATTERNS.some(p => p.test(name));

// ── JID-based detection (Baileys rc13) ───────────────────────────────────────
// WhatsApp Business API bots / Meta AI agents use these server suffixes
const BOT_SERVERS = ['@hosted.lid', '@hosted', '@agent', '@bot.whatsapp.net'];

const isBotJid = (jid) => {
    if (!jid || typeof jid !== 'string') return false;
    return BOT_SERVERS.some(s => jid.endsWith(s));
};

// ── Safe fetchStatus for rc13 ─────────────────────────────────────────────────
// rc13: fetchStatus(...jids) → array of USync result objects, not a single object.
// Returns the status string or null; never throws.
const safeGetStatus = async (sock, jid) => {
    try {
        const results = await sock.fetchStatus(jid);
        if (!results) return null;
        // rc13 returns an array; find entry matching the requested jid
        if (Array.isArray(results)) {
            const entry = results.find(r =>
                r?.id === jid ||
                r?.jid === jid ||
                r?.id?.user === jid.split('@')[0]
            );
            return entry?.status?.status || entry?.status || null;
        }
        // Older shape fallback
        return results?.status || null;
    } catch {
        return null;
    }
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const getBotJid = (sock) => {
    const id = sock?.user?.id;
    if (!id) return null;
    return id.includes(':') ? id.split(':')[0] + '@s.whatsapp.net' : id;
};

// Admin check that handles LID addressing (rc13 groups have mixed PN/LID JIDs)
const isParticipantAdmin = (participants = [], jid) => {
    if (!jid) return false;
    const num = jid.split('@')[0].split(':')[0];
    return participants.some(p => {
        if (p.admin !== 'admin' && p.admin !== 'superadmin') return false;
        const pNum = (p.id || p.lid || '').split('@')[0].split(':')[0];
        return pNum === num;
    });
};

// ── Main detection: returns true if the JID should be treated as a bot ────────
const isSuspectedBot = async (sock, jid, pushName) => {
    // 1. JID server type — definitive for WA API bots
    if (isBotJid(jid)) return true;

    // 2. Name-based check (jid number + pushName)
    const numPart = jid.split('@')[0];
    if (isBotName(numPart) || isBotName(pushName)) return true;

    // 3. Status bio fallback via fetchStatus (may not always succeed)
    const bio = await safeGetStatus(sock, jid);
    if (bio && isBotName(bio)) return true;

    return false;
};

// ── Command ───────────────────────────────────────────────────────────────────
module.exports = {
    name: 'antibot',
    aliases: ['nobot', 'botblock'],
    category: 'admin',
    description: 'Auto-kick suspected bot/agent accounts from the group',
    usage: '.antibot on | off | status',
    groupOnly: true,
    adminOnly: true,
    botAdminNeeded: true,

    async execute(sock, msg, args, extra) {
        const { from, reply, react } = extra;
        const sub = (args[0] || '').toLowerCase();
        const gs  = database.getGroupSettings(from);

        if (!sub || sub === 'status') {
            return reply(
                `🤖 *AntiBot Settings*\n` +
                `━━━━━━━━━━━━━━━\n` +
                `📌 Status: *${gs.antibot ? '✅ ON' : '❌ OFF'}*\n\n` +
                `*Detection methods:*\n` +
                `  • WhatsApp API agent JIDs (@hosted.lid / @hosted)\n` +
                `  • Name keyword matching (bot, ai, assistant, robot…)\n` +
                `  • Profile bio scanning\n\n` +
                `*Commands:*\n` +
                `  .antibot on      — enable\n` +
                `  .antibot off     — disable\n` +
                `  .antibot status  — show this panel\n\n` +
                `_Admins and bot owner are always exempt._`
            );
        }

        if (sub === 'on') {
            if (gs.antibot) return reply('🤖 AntiBot is already *ON*.');
            database.updateGroupSettings(from, { antibot: true });
            await react('✅');
            return reply('🤖 *AntiBot* turned *ON*.\nSuspected bot accounts will be auto-kicked on join or message.');
        }

        if (sub === 'off') {
            database.updateGroupSettings(from, { antibot: false });
            await react('❌');
            return reply('🤖 *AntiBot* turned *OFF*.');
        }

        return reply('⚠️ Unknown option. Use .antibot for help.');
    },

    // ── On group join ──────────────────────────────────────────────────────────
    async handleGroupJoin(sock, from, participant) {
        try {
            const gs = database.getGroupSettings(from);
            if (!gs.antibot) return;

            // Never kick the bot itself
            const selfJid = getBotJid(sock);
            if (selfJid && participant.split('@')[0] === selfJid.split('@')[0]) return;

            const detected = await isSuspectedBot(sock, participant, null);
            if (!detected) return;

            await sock.groupParticipantsUpdate(from, [participant], 'remove');
            await sock.sendMessage(from, {
                text:
                    `🤖 *AntiBot* — Auto-kicked *@${participant.split('@')[0]}*\n` +
                    `📌 Reason: Detected as a bot/agent account on join.`,
                mentions: [participant]
            });
        } catch (e) {
            console.error('[ANTIBOT] handleGroupJoin error:', e.message);
        }
    },

    // ── On message ────────────────────────────────────────────────────────────
    async handleMessage(sock, msg, groupMetadata) {
        try {
            if (!msg?.key || !msg.message) return;

            const from = msg.key.remoteJid;
            if (!from?.endsWith('@g.us')) return;

            const gs = database.getGroupSettings(from);
            if (!gs.antibot) return;

            // Skip own messages
            if (msg.key.fromMe) return;

            const sender = msg.key.participant || msg.key.remoteJid;
            if (!sender) return;

            // Never kick the bot itself
            const selfJid = getBotJid(sock);
            if (selfJid && sender.split('@')[0] === selfJid.split('@')[0]) return;

            // Exempt owner
            const senderNum = sender.split('@')[0].split(':')[0];
            if (config.ownerNumber?.some(o => o.replace(/\D/g, '') === senderNum)) return;

            // Exempt admins (LID-aware check)
            const participants = groupMetadata?.participants || [];
            if (isParticipantAdmin(participants, sender)) return;

            const pushName = msg.pushName || '';
            const detected = await isSuspectedBot(sock, sender, pushName);
            if (!detected) return;

            await sock.groupParticipantsUpdate(from, [sender], 'remove');
            await sock.sendMessage(from, {
                text:
                    `🤖 *AntiBot* — Auto-kicked *@${senderNum}*\n` +
                    `📌 Reason: Detected as a bot/agent account via message.`,
                mentions: [sender]
            });
        } catch (e) {
            console.error('[ANTIBOT] handleMessage error:', e.message);
        }
    }
};
