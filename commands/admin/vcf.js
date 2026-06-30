/**
 * VCF Command - Export group members as a VCF contacts file
 * Uses the participant `jid` field (phone number) directly when available,
 * with LID mapping as fallback.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const { getLidMappingValue } = require(require('path').join(global.__CORE__, 'utils', 'jidHelper'));

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

            const participants = extra.groupMetadata.participants;
            const groupName = extra.groupMetadata.subject || 'Group';

            const validNumbers = [];

            for (const p of participants) {
                const jid = p.jid || '';
                const id  = p.id  || '';

                // Prefer `jid` field (real phone number)
                if (jid.endsWith('@s.whatsapp.net')) {
                    const num = jid.replace('@s.whatsapp.net', '').replace(/\D/g, '');
                    if (/^\d{7,15}$/.test(num)) {
                        validNumbers.push(num);
                        continue;
                    }
                }

                // Fallback: regular phone-number `id`
                if (id.endsWith('@s.whatsapp.net')) {
                    const num = id.replace('@s.whatsapp.net', '').replace(/\D/g, '');
                    if (/^\d{7,15}$/.test(num)) {
                        validNumbers.push(num);
                        continue;
                    }
                }

                // Last resort: LID → PN mapping file
                const rawId = id || jid;
                if (rawId.endsWith('@lid') || rawId.endsWith('@hosted.lid')) {
                    const lidUser = rawId.split('@')[0];
                    const pnUser  = getLidMappingValue(lidUser, 'lidToPn');
                    if (pnUser && /^\d{7,15}$/.test(pnUser)) {
                        validNumbers.push(pnUser);
                    }
                }
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

            // Send the VCF file as a document
            const fileBuffer = fs.readFileSync(filePath);
            await sock.sendMessage(chatId, {
                document: fileBuffer,
                mimetype: 'text/vcard',
                fileName: `${safeName}_contacts.vcf`,
                caption: `📇 ${groupName} — ${validNumbers.length} contact(s)`
            }, { quoted: msg });

            // Clean up
            fs.unlinkSync(filePath);

        } catch (error) {
            console.error('VCF command error:', error);
            await sock.sendMessage(chatId, {
                text: `🚫 Error: ${error.message}`
            }, { quoted: msg });
        }
    }
};
