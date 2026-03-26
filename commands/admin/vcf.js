/**
 * VCF Command - Export group members as a VCF contacts file
 * Resolves LID participants to real phone numbers using the session LID mapping.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const { getLidMappingValue } = require('../../utils/jidHelper');

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
                const id = p.id || '';

                if (id.endsWith('@s.whatsapp.net')) {
                    // Regular phone number participant
                    const num = id.replace('@s.whatsapp.net', '').trim();
                    if (/^\d{7,15}$/.test(num)) {
                        validNumbers.push(num);
                    }
                } else if (id.endsWith('@lid') || id.endsWith('@hosted.lid')) {
                    // LID participant — try to resolve to real phone number
                    const lidUser = id.split('@')[0];
                    const pnUser = getLidMappingValue(lidUser, 'lidToPn');
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
                vcfContent += `TEL;TYPE=CELL:+${num}\n`;
                vcfContent += `END:VCARD\n`;
            });

            // Write to temp file
            const tempDir = path.join(os.tmpdir(), 'june-x-temp');
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

            const safeName = groupName.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 40);
            const filePath = path.join(tempDir, `${safeName}_contacts.vcf`);
            fs.writeFileSync(filePath, vcfContent);

            await sock.sendMessage(chatId, {
                text: `✅ *VCF Exported Successfully*\n\n📋 Group: *${groupName}*\n👥 Valid Contacts: *${validNumbers.length}*`
            }, { quoted: msg });

            // Send the VCF file as a document
            const fileBuffer = fs.readFileSync(filePath);
            await sock.sendMessage(chatId, {
                document: fileBuffer,
                mimetype: 'text/vcard',
                fileName: `${safeName}_contacts.vcf`
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
