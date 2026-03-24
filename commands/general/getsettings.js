const config = require('../../config');
const database = require('../../database');

module.exports = {
    name: 'getsettings',
    aliases: ['settings', 'groupsettings', 'gsettings'],
    category: 'general',
    description: 'View all bot settings (group settings in groups, bot settings in DMs)',
    usage: '.settings',

    async execute(sock, msg, args, extra) {
        try {
            const isGroup = extra.from.endsWith('@g.us');

            if (isGroup) {
                const gs = database.getGroupSettings(extra.from);
                let groupName = 'This Group';
                try {
                    const meta = await sock.groupMetadata(extra.from);
                    groupName = meta?.subject || 'This Group';
                } catch (_) {}

                const on = '✅';
                const off = '❌';

                const text = `⚙️ *Group Settings — ${groupName}*\n━━━━━━━━━━━━━━━━━━━━━\n\n` +
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
                    `${gs.detect ? on : off} Detect\n\n` +
                    `> *${config.botName}* — Powered by Supreme`;

                await sock.sendMessage(extra.from, { text }, { quoted: msg });

            } else {
                const prefix = config.prefix === '' ? 'none' : (config.prefix || '.');
                const ownerName = Array.isArray(config.ownerName) ? config.ownerName[0] : config.ownerName;
                const ownerNums = [].concat(config.ownerNumber || []).join(', ');

                let asvStatus = 'OFF';
                try {
                    const asv = require('../owner/autostatusview');
                    const asvSettings = asv.loadSettings();
                    asvStatus = asvSettings.enabled ? `ON (react: ${asvSettings.react ? asvSettings.emoji : 'off'})` : 'OFF';
                } catch (_) {}

                const text = `⚙️ *Bot Settings*\n━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `🤖 *General*\n` +
                    `📛 Bot Name: *${config.botName}*\n` +
                    `🔧 Prefix: *${prefix}*\n` +
                    `👑 Owner: *${ownerName}*\n` +
                    `📞 Owner Numbers: ${ownerNums}\n` +
                    `🕐 Timezone: *${config.timezone || 'UTC'}*\n` +
                    `🎨 Pack Name: *${config.packname || 'N/A'}*\n\n` +
                    `📌 *Bot Behavior*\n` +
                    `${config.selfMode ? '🔒' : '🔓'} Mode: ${config.selfMode ? 'Self (Private)' : 'Public'}\n` +
                    `${config.autoRead ? '✅' : '❌'} Auto Read\n` +
                    `${config.autoTyping ? '✅' : '❌'} Auto Typing\n` +
                    `${config.autoBio ? '✅' : '❌'} Auto Bio\n` +
                    `${config.autoSticker ? '✅' : '❌'} Auto Sticker\n` +
                    `${config.autoReact ? '✅' : '❌'} Auto React (${config.autoReactMode || 'bot'})\n` +
                    `${config.autoDownload ? '✅' : '❌'} Auto Download\n\n` +
                    `👁️ *Status*\n` +
                    `📡 Auto Status View: *${asvStatus}*\n\n` +
                    `🔗 *Links*\n` +
                    `🐙 GitHub: ${config.social?.github || 'N/A'}\n` +
                    `📺 YouTube: ${config.social?.youtube || 'N/A'}\n\n` +
                    `> *${config.botName}* — Powered by Supreme`;

                await sock.sendMessage(extra.from, { text }, { quoted: msg });
            }

        } catch (error) {
            console.error('getsettings error:', error);
            await extra.reply(`❌ Error: ${error.message}`);
        }
    }
};
