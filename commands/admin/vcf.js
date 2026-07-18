/**
 * ╔════════════════════════════════════════════════════════╗
 * ║  FILE    : vcf.js                                      ║
 * ║  FEATURE : Export group members as a VCF contacts file ║
 * ║  SCOPE   : Admin — Group only                          ║
 * ╚════════════════════════════════════════════════════════╝
 *
 * Uses the same LID resolution strategy as antiforeign.js:
 *   1. p.phoneNumber from groupMetadata() (Baileys v7+)
 *   2. Baileys in-memory signalRepository.lidMapping
 *   3. lid-mapping-<user>_reverse.json on disk
 */

const os   = require('os');
const fs   = require('fs');
const path = require('path');
const { jidDecode } = require('@whiskeysockets/baileys');
const { resolvePhone, preloadLidResolution } = require(path.join(global.__ROOT__, 'utils', 'jidHelper'));

module.exports = {
    name: 'vcf',
    aliases: ['vcard', 'contacts', 'exportcontacts'],
    category: 'admin',
    description: 'Export all group members as a VCF contacts file',
    usage: '.vcf',
    groupOnly: true,
    adminOnly: true,

    async execute(sock, msg, args, extra) {
        const chatId = extra.from;

        try {
            await sock.sendMessage(chatId, { react: { text: '📇', key: msg.key } });

            const participants = extra.groupMetadata?.participants || [];
            const groupName    = extra.groupMetadata?.subject || 'Group';

            // Nudge LID resolution before scanning
            await preloadLidResolution(sock, participants);

            const botJid   = sock.user?.id || '';
            const botPhone = (await resolvePhone(sock, botJid)) || botJid.split('@')[0].split(':')[0];

            const validNumbers = [];

            for (const p of participants) {
                // 1. phoneNumber field attached by Baileys v7 groupMetadata()
                let phone = null;
                if (p.phoneNumber) {
                    const dec = jidDecode(p.phoneNumber);
                    phone = dec?.user?.split(':')[0] || String(p.phoneNumber).split('@')[0].split(':')[0];
                }

                // 2. Full LID resolution (in-memory store → file fallback)
                if (!phone) phone = await resolvePhone(sock, p.id);

                // 3. Last resort — strip plain @s.whatsapp.net JID
                if (!phone && (p.id || '').endsWith('@s.whatsapp.net')) {
                    phone = p.id.replace('@s.whatsapp.net', '').split(':')[0];
                }

                if (!phone) continue;
                const digits = phone.replace(/\D/g, '');
                if (!/^\d{7,15}$/.test(digits)) continue;
                if (digits === botPhone) continue;  // skip bot itself

                validNumbers.push(digits);
            }

            if (validNumbers.length === 0) {
                return await sock.sendMessage(chatId, {
                    text: '❌ No valid phone numbers found in this group.'
                }, { quoted: msg });
            }

            // Build VCF content
            let vcfContent = '';
            validNumbers.forEach((num, index) => {
                vcfContent += `BEGIN:VCARD\n`;
                vcfContent += `VERSION:3.0\n`;
                vcfContent += `FN:${groupName} ${index + 1}\n`;
                vcfContent += `ORG:${groupName};\n`;
                vcfContent += `TEL;TYPE=CELL,VOICE:+${num}\n`;
                vcfContent += `END:VCARD\n`;
            });

            // Write to temp file
            const tempDir = path.join(os.tmpdir(), 'june-x-temp');
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

            const safeName = groupName.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 40);
            const filePath = path.join(tempDir, `${safeName}_contacts.vcf`);
            fs.writeFileSync(filePath, vcfContent);

            const fileBuffer = fs.readFileSync(filePath);
            await sock.sendMessage(chatId, {
                document: fileBuffer,
                mimetype: 'text/vcard',
                fileName: `${safeName}_contacts.vcf`,
                caption: `📇 *${groupName}* — ${validNumbers.length} contact(s) exported`
            }, { quoted: msg });

            fs.unlinkSync(filePath);

        } catch (error) {
            console.error('[vcf]', error.message);
            await sock.sendMessage(chatId, {
                text: `🚫 Error: ${error.message}`
            }, { quoted: msg });
        }
    }
};
