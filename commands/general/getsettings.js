const { sendButtons } = require('gifted-btns');
const config   = require('../../config');
const database = require('../../database');

module.exports = {
    name: 'getsettings',
    aliases: ['settings', 'groupsettings', 'gsettings'],
    category: 'general',
    description: 'View all bot settings (group settings in groups, bot settings in DMs)',
    usage: '.settings',

    async execute(sock, msg, args, extra) {
        try {
            const chatId   = extra.from;
            const isGroup  = chatId.endsWith('@g.us');
            const footer   = `> Powered by ${config.botName}`;

            // Build owner WhatsApp URL from first valid owner number
            const ownerNums   = [].concat(config.ownerNumber || []).filter(n => String(n).replace(/\D/g, ''));
            const ownerDigits = ownerNums.length ? String(ownerNums[0]).replace(/\D/g, '') : '';
            const ownerUrl    = ownerDigits ? `https://wa.me/${ownerDigits}` : 'https://wa.me';
            const repoUrl     = config.social?.github || 'https://github.com/Vinpink2/June-X-Ultra';

            const buttons = [
                {
                    name: 'cta_url',
                    buttonParamsJson: JSON.stringify({
                        display_text: '👑 Contact Owner',
                        url: ownerUrl
                    })
                },
                {
                    name: 'cta_url',
                    buttonParamsJson: JSON.stringify({
                        display_text: '🔗 Bot Repo',
                        url: repoUrl
                    })
                }
            ];

            if (isGroup) {
                const gs = database.getGroupSettings(chatId);
                let groupName = 'This Group';
                try {
                    const meta = await sock.groupMetadata(chatId);
                    groupName = meta?.subject || 'This Group';
                } catch (_) {}

                const on  = '✅';
                const off = '❌';

                const text =
                    `⚙️ *Group Settings — ${groupName}*\n━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `🔗 *Protection*\n` +
                    `${gs.antilink ? on : off} Antilink (${gs.antilinkAction || 'delete'})\n` +
                    `${gs.antitag ? on : off} Antitag (${gs.antitagAction || 'delete'})\n` +
                    `${gs.antigroupmention ? on : off} Anti Group Mention (${gs.antigroupmentionAction || 'delete'})\n` +
                    `${gs.antigroupstatus ? on : off} Anti Group Status (${gs.antigroupstatusAction || 'delete'})\n` +
                    `${gs.antiall ? on : off} Anti All\n` +
                    `${gs.antiviewonce ? on : off} Anti View Once\n` +
                    `${gs.antibot ? on : off} Anti Bot\n` +
                    `${gs.anticall ? on : off} Anti Call\n` +
                    `${gs.antiimage ? on : off} Anti Image (${gs.antiimageAction || 'delete'})\n` +
                    `${gs.antisticker ? on : off} Anti Sticker (${gs.antistickerAction || 'delete'})\n` +
                    `${gs.antiaudio ? on : off} Anti Audio (${gs.antiaudioAction || 'delete'})\n` +
                    `${gs.antiSpam ? on : off} Anti Spam\n` +
                    `${gs.antidelete ? on : off} Anti Delete\n\n` +
                    `👋 *Welcome/Goodbye*\n` +
                    `${gs.welcome ? on : off} Welcome\n` +
                    `${gs.goodbye ? on : off} Goodbye\n\n` +
                    `🤖 *Features*\n` +
                    `${gs.chatbot ? on : off} Chatbot\n` +
                    `${gs.autosticker ? on : off} Auto Sticker\n` +
                    `${gs.nsfw ? on : off} NSFW\n` +
                    `${gs.detect ? on : off} Detect`;

                await sendButtons(sock, chatId, { text, footer, buttons }, { quoted: msg });

            } else {
                const prefix    = config.prefix === '' ? 'none' : (config.prefix || '.');
                const ownerName = Array.isArray(config.ownerName) ? config.ownerName[0] : config.ownerName;

                let asvStatus = 'OFF';
                try {
                    const asv = require('../owner/autostatusview');
                    const asvSettings = asv.loadSettings();
                    asvStatus = asvSettings.enabled
                        ? `ON (react: ${asvSettings.react ? asvSettings.emoji : 'off'})`
                        : 'OFF';
                } catch (_) {}

                // Presence mode label — read live from presence.json
                let presenceMode = '❌ OFF';
                try {
                    const { getMode } = require('../../utils/presenceSettings');
                    const pm = getMode();
                    if (pm === 'recordtype') presenceMode = '🎙️⌨️ Record+Type';
                    else if (pm === 'recording') presenceMode = '🎙️ Recording';
                    else if (pm === 'typing')    presenceMode = '⌨️ Typing';
                } catch (_) {}

                const text =
                    `⚙️ *Bot Settings*\n━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `🤖 *General*\n` +
                    `📛 Bot Name: *${config.botName}*\n` +
                    `🔧 Prefix: *${prefix === '' ? 'none' : prefix}*\n` +
                    `👑 Owner: *${ownerName}*\n` +
                    `📞 Owner Number: ${ownerDigits || 'N/A'}\n` +
                    `🕐 Timezone: *${config.timezone || 'UTC'}*\n` +
                    `🎨 Pack Name: *${config.packname || 'N/A'}*\n\n` +
                    `📌 *Bot Behaviour*\n` +
                    `${config.selfMode     ? '🔒' : '🔓'} Mode: ${config.selfMode ? 'Self (Private)' : 'Public'}\n` +
                    `${config.autoRead     ? '✅' : '❌'} Auto Read\n` +
                    `${config.autoBio      ? '✅' : '❌'} Auto Bio\n` +
                    `${config.autoSticker  ? '✅' : '❌'} Auto Sticker\n` +
                    `${config.autoDownload ? '✅' : '❌'} Auto Download\n` +
                    `${config.autoReact    ? '✅' : '❌'} Auto React (${config.autoReactMode || 'bot'})\n\n` +
                    `🎙️ *Presence (Fake Indicators)*\n` +
                    `📡 Mode: *${presenceMode}*\n` +
                    `  .autorecording — fake voice note recording\n` +
                    `  .autorecordtype — recording → typing combo\n` +
                    `  .autotyping — typing only\n\n` +
                    `👁️ *Status*\n` +
                    `📡 Auto Status View: *${asvStatus}*\n\n` +
                    `🔗 *Links*\n` +
                    `🐙 GitHub: ${repoUrl}\n` +
                    `📺 YouTube: ${config.social?.youtube || 'N/A'}`;

                await sendButtons(sock, chatId, { text, footer, buttons }, { quoted: msg });
            }

        } catch (error) {
            console.error('getsettings error:', error);
            await extra.reply(`❌ Error: ${error.message}`);
        }
    }
};
