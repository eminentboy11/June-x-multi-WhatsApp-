/**
 * AntiDeleteStatus — recovers deleted WhatsApp statuses globally.
 *
 * All deleted statuses from any contact are forwarded to bot.user.id (self-chat).
 *
 * Config: data/antideletestatus.json  { "enabled": true | false }
 */

const fs   = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

const CONFIG_PATH = path.join(__dirname, '../../data/antideletestatus.json');

// ── Config helpers ────────────────────────────────────────────────────────────

function loadConfig() {
    try {
        if (!fs.existsSync(CONFIG_PATH))
            fs.writeFileSync(CONFIG_PATH, JSON.stringify({ enabled: false }, null, 2));
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch { return { enabled: false }; }
}

function saveConfig(cfg) {
    try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2)); } catch {}
}

function isEnabled() { return loadConfig().enabled === true; }

// ── In-memory status store ────────────────────────────────────────────────────
// Map<msgId, entry>  — statuses all share jid = 'status@broadcast'
const statusStore = new Map();

const STATUS_JID = 'status@broadcast';

const MEDIA_TYPES = {
    imageMessage:    'image',
    videoMessage:    'video',
    audioMessage:    'audio',
    documentMessage: 'document',
};

function unwrap(raw) {
    return (
        raw.ephemeralMessage?.message ||
        raw.viewOnceMessageV2Extension?.message ||
        raw.viewOnceMessageV2?.message ||
        raw.viewOnceMessage?.message ||
        raw
    );
}

function storeStatusMessage(msg) {
    try {
        if (!msg?.key?.id || !msg.message) return;
        if (msg.key.remoteJid !== STATUS_JID) return;

        const sender = msg.key.participant || msg.key.remoteJid;
        const inner  = unwrap(msg.message);

        const text =
            inner.conversation ||
            inner.extendedTextMessage?.text ||
            inner.imageMessage?.caption ||
            inner.videoMessage?.caption ||
            inner.documentMessage?.caption ||
            null;

        const mtype = Object.keys(MEDIA_TYPES).find(k => inner[k]);
        if (!text && !mtype) return;

        statusStore.set(msg.key.id, {
            sender,
            timestamp: msg.messageTimestamp,
            type:  mtype ? MEDIA_TYPES[mtype] : 'text',
            mtype: mtype || null,
            inner,
            text:  text || null,
        });

        // Keep at most 200 statuses in memory
        if (statusStore.size > 200) statusStore.delete(statusStore.keys().next().value);
    } catch (_) {}
}

// ── Bot self JID ──────────────────────────────────────────────────────────────
function botSelfJid(sock) {
    const id = sock.user?.id;
    if (!id) return null;
    return id.includes(':') ? id.split(':')[0] + '@s.whatsapp.net' : id;
}

// ── Download media ────────────────────────────────────────────────────────────
async function downloadMedia(stored) {
    try {
        const stream = await downloadContentFromMessage(stored.inner[stored.mtype], stored.type);
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        return Buffer.concat(chunks);
    } catch { return null; }
}

// ── Send recovered status ─────────────────────────────────────────────────────
async function sendRecoveredStatus(sock, targetJid, stored) {
    const senderNum = (stored.sender || 'Unknown').split('@')[0].split(':')[0];
    const divider   = '━━━━━━━━━━━━━━━━━━━━';
    const readmore  = String.fromCharCode(8206).repeat(4001);

    const timestamp = stored.timestamp
        ? new Date(stored.timestamp * 1000).toLocaleString('en-GB', {
            hour12: false, timeZone: 'Africa/Nairobi',
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
          })
        : new Date().toLocaleString();

    const typeEmoji = {
        image: '🖼️', video: '🎬', audio: '🎵',
        document: '📄', text: '📝',
    }[stored.type] || '📝';

    const header =
        `🗑️ *DELETED STATUS RECOVERED!*\n` +
        `${divider}\n` +
        `👤 *From:* @${senderNum}\n` +
        `🕐 *Time:* ${timestamp}\n` +
        `${typeEmoji} *Type:* ${stored.type}\n` +
        `${divider}\n${readmore}\n`;

    const mentions = stored.sender ? [stored.sender] : [];

    if (stored.type === 'text') {
        await sock.sendMessage(targetJid, {
            text: `${header}📝 *Status:*\n${stored.text}\n${divider}`,
            mentions,
        });
        return;
    }

    const buffer = await downloadMedia(stored);

    if (!buffer) {
        await sock.sendMessage(targetJid, {
            text: `${header}⚠️ _Media expired (CDN link gone)._\n${divider}`,
            mentions,
        });
        return;
    }

    const caption =
        `🗑️ *DELETED STATUS RECOVERED!*\n${divider}\n` +
        `👤 *From:* @${senderNum}\n` +
        `🕐 *Time:* ${timestamp}\n` +
        `${typeEmoji} *Type:* ${stored.type}` +
        (stored.text ? `\n${divider}\n${readmore}\n📝 *Caption:*\n${stored.text}` : '') +
        `\n${divider}`;

    if (stored.type === 'image') {
        await sock.sendMessage(targetJid, { image: buffer, caption, mentions });
    } else if (stored.type === 'video') {
        await sock.sendMessage(targetJid, {
            video: buffer, caption, mentions,
            mimetype: stored.inner?.videoMessage?.mimetype || 'video/mp4',
        });
    } else if (stored.type === 'audio') {
        const isVoice = stored.inner?.audioMessage?.ptt === true;
        await sock.sendMessage(targetJid, {
            audio: buffer, ptt: isVoice,
            mimetype: stored.inner?.audioMessage?.mimetype || 'audio/ogg; codecs=opus',
        });
        await sock.sendMessage(targetJid, { text: header, mentions });
    } else if (stored.type === 'document') {
        await sock.sendMessage(targetJid, {
            document: buffer,
            mimetype: stored.inner?.documentMessage?.mimetype || 'application/octet-stream',
            fileName: stored.inner?.documentMessage?.fileName || 'status_file',
            caption, mentions,
        });
    }
}

// ── Handle delete events ──────────────────────────────────────────────────────
async function handleStatusDelete(sock, updates) {
    try {
        if (!isEnabled()) return;

        const selfJid = botSelfJid(sock);
        if (!selfJid) return;

        for (const { key } of updates) {
            // Status deletions may arrive with remoteJid = status@broadcast OR the
            // sender's own JID depending on Baileys version — match either way.
            const isStatusJid = key.remoteJid === STATUS_JID;
            const storedById  = statusStore.get(key.id);

            if (!isStatusJid && !storedById) continue;

            // Look up the stored status by message ID
            const stored = storedById || null;
            if (!stored) continue;

            await sendRecoveredStatus(sock, selfJid, stored);
            statusStore.delete(key.id);
        }
    } catch (e) {
        console.error('[ANTIDELETESTATUS] error:', e.message);
    }
}

// ── Command module ────────────────────────────────────────────────────────────
module.exports = {
    name: 'antideletestatus',
    aliases: ['antidelstatus', 'statusprotect'],
    category: 'owner',
    description: 'Recover deleted statuses — sends them to bot self-chat',
    usage: '.antideletestatus on | off',
    adminOnly: true,

    storeStatusMessage,
    handleStatusDelete,

    async execute(sock, msg, args, extra) {
        const { reply } = extra;
        const sub = (args[0] || '').toLowerCase();
        const cfg = loadConfig();

        const statusLabel = () => cfg.enabled
            ? '✅ ON — deleted statuses → bot self-chat'
            : '❌ OFF';

        if (!sub) {
            return reply(
                `📸 *Anti-Delete Status*\n` +
                `━━━━━━━━━━━━━━━\n` +
                `📌 Status: *${statusLabel()}*\n\n` +
                `Recovers deleted statuses\n\n` +
                `*Commands:*\n` +
                `  .antideletestatus on  — activate\n` +
                `  .antideletestatus off — deactivate`
            );
        }

        if (sub === 'on') {
            saveConfig({ enabled: true });
            return reply('✅ *Anti-Delete Status* activated .');
        }

        if (sub === 'off') {
            saveConfig({ enabled: false });
            return reply('❌ *Anti-Delete Status* deactivated.');
        }

        return reply('⚠️ Usage: .antideletestatus on | off');
    },
};
