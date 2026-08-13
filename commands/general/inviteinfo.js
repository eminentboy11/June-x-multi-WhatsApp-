/**
 * Invite Info — sock.groupGetInviteInfo(code)
 * Inspect a chat.whatsapp.com link without joining.
 */

const config = require('../../config');
const { jidUser, resolvePhone, rememberLidMapping } = require('../../utils/jidHelper');

function extractInviteCode(input) {
    if (!input) return null;
    const text = String(input).trim();
    const match = text.match(/chat\.whatsapp\.com\/(?:invite\/)?([A-Za-z0-9_-]{10,})/i);
    if (match) return match[1];
    if (/^[A-Za-z0-9_-]{10,}$/.test(text)) return text;
    return null;
}

function getQuotedText(msg) {
    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    const quoted = ctx?.quotedMessage;
    if (!quoted) return '';
    return (
        quoted.conversation ||
        quoted.extendedTextMessage?.text ||
        quoted.imageMessage?.caption ||
        quoted.videoMessage?.caption ||
        ''
    );
}

function formatWhen(unix, timeZone) {
    if (!unix) return 'Unknown';
    try {
        return new Date(unix * 1000).toLocaleString('en-GB', {
            timeZone: timeZone || 'UTC',
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch (_) {
        return new Date(unix * 1000).toISOString();
    }
}

function displayId(jid) {
    if (!jid) return 'Unknown';
    return jidUser(jid) || String(jid).split('@')[0];
}

async function preferPn(sock, lidOrPn, fallbackPn) {
    if (fallbackPn) return fallbackPn;
    if (!lidOrPn) return null;
    if (!String(lidOrPn).endsWith('@lid')) return lidOrPn;
    const phone = await resolvePhone(sock, lidOrPn);
    if (phone) {
        rememberLidMapping(lidOrPn, phone);
        return phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;
    }
    return lidOrPn;
}

module.exports = {
    name: 'inviteinfo',
    aliases: ['inspect', 'gclinkinfo', 'linkinfo'],
    category: 'general',
    description: 'Preview a group from its invite link without joining',
    usage: '.inviteinfo https://chat.whatsapp.com/XXXX',

    async execute(sock, msg, args, extra) {
        const blob = [(args || []).join(' '), getQuotedText(msg)].filter(Boolean).join(' ');
        const code = extractInviteCode(blob);

        if (!code) {
            return extra.reply(
                `🔎 *Invite Info*\n\n` +
                `Usage: .inviteinfo https://chat.whatsapp.com/XXXX\n` +
                `Or reply to a message that contains the link.\n\n` +
                `_Does not join the group._`
            );
        }

        try {
            if (extra.react) await extra.react('🔎').catch(() => {});
            const info = await sock.groupGetInviteInfo(code);
            const tz = config.timezone || 'Africa/Lagos';

            const ownerJid = await preferPn(sock, info.owner, info.ownerPn);
            const subjectOwner = await preferPn(sock, info.subjectOwner, info.subjectOwnerPn);

            const lines = [
                `┏━━『 INVITE INFO 』━━`,
                ``,
                `➥ Name      ➜ ${info.subject || 'Unknown'}`,
                `➥ ID        ➜ ${info.id || 'Unknown'}`,
                `➥ Members   ➜ ${info.size ?? (info.participants || []).length}`,
                `➥ Created   ➜ ${formatWhen(info.creation, tz)}`,
                `➥ Owner     ➜ ${ownerJid ? '@' + displayId(ownerJid) : 'Unknown'}`,
            ];

            if (subjectOwner) lines.push(`➥ Named by  ➜ @${displayId(subjectOwner)}`);
            lines.push(`➥ Announce  ➜ ${info.announce ? 'admins only' : 'everyone'}`);
            lines.push(`➥ Locked    ➜ ${info.restrict ? 'admins change info' : 'anyone can change'}`);
            lines.push(`➥ Join ask  ➜ ${info.joinApprovalMode ? 'approval required' : 'open'}`);
            lines.push(`➥ Add mode  ➜ ${info.memberAddMode ? 'any member' : 'admins only'}`);
            if (info.isCommunity) lines.push(`➥ Type      ➜ community`);
            if (info.linkedParent) lines.push(`➥ Parent    ➜ ${info.linkedParent}`);
            if (info.ephemeralDuration) {
                const hours = Math.round(info.ephemeralDuration / 3600);
                lines.push(`➥ Disappear ➜ ${hours}h`);
            }
            if (info.desc) {
                const desc = String(info.desc).trim();
                lines.push(``);
                lines.push(`┃ Description`);
                lines.push(desc.length > 400 ? `${desc.slice(0, 400)}…` : desc);
            }
            lines.push(``);
            lines.push(`➥ Link      ➜ https://chat.whatsapp.com/${code}`);
            lines.push(``);
            lines.push(`┗━━━━━━━━━━━━━━━━`);

            const mentions = [ownerJid, subjectOwner].filter(Boolean);
            await sock.sendMessage(extra.from, {
                text: lines.join('\n'),
                mentions,
            }, { quoted: msg });

            if (extra.react) await extra.react('✅').catch(() => {});
        } catch (error) {
            console.error('[inviteinfo]', error.message);
            if (extra.react) await extra.react('❌').catch(() => {});
            const expired = /404|not-found|gone|invalid|item-not-found/i.test(error.message || '');
            await extra.reply(
                expired
                    ? '❌ That invite link is invalid or has been reset.'
                    : `❌ Could not read invite: ${error.message}`
            );
        }
    },
};
