const fs   = require('fs');
const path = require('path');
const { sendButtons } = require('gifted-btns');
const config   = require('../../config');
const database = require('../../database');

const on  = '✅';
const off = '❌';
const flag = (v) => (v ? on : off);

function readJson(filePath) {
    try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
    catch { return {}; }
}

module.exports = {
    name: 'getsettings',
    aliases: ['settings', 'groupsettings', 'gsettings'],
    category: 'general',
    description: 'View all bot and group settings',
    usage: '.settings',

    async execute(sock, msg, args, extra) {
        try {
            const chatId  = extra.from;
            const isGroup = chatId.endsWith('@g.us');
            const footer  = `> ᴘᴏᴡᴇʀᴇᴅ ʙʏ ${config.botName} v${config.version}`;

            const ownerNums   = [].concat(config.ownerNumber || []).filter(n => String(n).replace(/\D/g, ''));
            const ownerDigits = ownerNums.length ? String(ownerNums[0]).replace(/\D/g, '') : '';
            const ownerName   = Array.isArray(config.ownerName) ? config.ownerName[0] : config.ownerName;

            const buttons = [
                {
                    name: 'cta_url',
                    buttonParamsJson: JSON.stringify({
                        display_text: '👑 Contact Owner',
                        url: ownerDigits ? `https://wa.me/${ownerDigits}` : 'https://wa.me'
                    })
                },
                {
                    name: 'cta_url',
                    buttonParamsJson: JSON.stringify({
                        display_text: '🔗 GitHub Repo',
                        url: config.social?.github || 'https://github.com/Vinpink2/June-X-Ultra'
                    })
                }
            ];

            /* ══════════════════════════════════════════════
               READ ALL LIVE SETTINGS
            ══════════════════════════════════════════════ */

            // Bot mode
            let botMode = '🌐 Public';
            try { botMode = require('../../utils/botMode').getModeLabel(); } catch (_) {}

            // Presence
            let presenceMode = 'Off';
            try {
                const pm = require('../../utils/presenceSettings').getMode();
                presenceMode = { typing: '⌨️ Typing', recording: '🎙️ Recording', recordtype: '🎙️⌨️ Record + Type' }[pm] || 'Off';
            } catch (_) {}

            // Auto read
            const autoReadMode = database.getBotSetting('autoReadMode') || 'off';

            // Auto react
            const autoReact     = database.getBotSetting('autoReact') || false;
            const autoReactMode = database.getBotSetting('autoReactMode') || 'bot';

            // Always online
            const alwaysOnline = database.getBotSetting('alwaysOnline') || false;

            // Read receipts
            const readReceipts = database.getBotSetting('readReceipts') || 'all';

            // Auto status view
            const asvEnabled = database.getBotSetting('autoStatusView')  || false;
            const asvReact   = database.getBotSetting('autoStatusReact') || false;
            const asvEmoji   = database.getBotSetting('autoStatusEmoji') || '💚';

            // Anti bug
            const antibug       = database.getBotSetting('antibug')       || false;
            const antibugAction = database.getBotSetting('antibugAction') || 'delete';

            // Anti delete (data/antidelete.json — global mode)
            const antideleteData = readJson(path.join(__dirname, '../../data/antidelete.json'));
            const antideleteMode = antideleteData['_global']?.mode || 'off';

            // Anti edit (data/antiedit.json)
            const antieditData = readJson(path.join(__dirname, '../../data/antiedit.json'));
            const antieditMode = antieditData.mode || 'off';

            // Anti delete status (data/antideletestatus.json)
            const antideleteStatusData = readJson(path.join(__dirname, '../../data/antideletestatus.json'));
            const antideleteStatus     = antideleteStatusData.enabled === true;

            // Display
            const menuStyle = database.getBotSetting('menuStyle') || '1';
            const fontStyle = database.getBotSetting('fontStyle') || 'normal';

            /* ══════════════════════════════════════════════
               BOT SETTINGS SECTION
            ══════════════════════════════════════════════ */
            const botSection =
                `╔══════════════════════╗\n` +
                `     ⚙️ *Bot Settings*\n` +
                `╚══════════════════════╝\n\n` +

                `🤖 *Identity*\n` +
                `┌─────────────────────\n` +
                `│ 📛 Name:     *${config.botName}*\n` +
                `│ 🔢 Version:  *v${config.version}*\n` +
                `│ 🔧 Prefix:   *${config.prefix || '.'}*\n` +
                `│ 🎨 Pack:     *${config.packname || 'N/A'}*\n` +
                `│ 🕐 Timezone: *${config.timezone || 'UTC'}*\n` +
                `└─────────────────────\n\n` +

                `👑 *Owner*\n` +
                `┌─────────────────────\n` +
                `│ 👤 Name:      *${ownerName}*\n` +
                `│ 📞 Number:    *${ownerDigits || 'N/A'}*\n` +
                `│ ⚠️ Max Warns: *${config.maxWarnings || 3}*\n` +
                `└─────────────────────\n\n` +

                `🌐 *Bot Mode & Presence*\n` +
                `┌─────────────────────\n` +
                `│ 🌐 Bot Mode:      *${botMode}*\n` +
                `│ 🕵️ Self Mode:     ${flag(config.selfMode)}\n` +
                `│ 🟢 Always Online: ${flag(alwaysOnline)}\n` +
                `│ 📡 Presence:      *${presenceMode}*\n` +
                `└─────────────────────\n\n` +

                `📨 *Auto Read & React*\n` +
                `┌─────────────────────\n` +
                `│ 📖 Auto Read:     *${autoReadMode}*\n` +
                `│ 💬 Auto React:    ${flag(autoReact)}${autoReact ? ` ┄ _${autoReactMode}_` : ''}\n` +
                `│ ✍️ Auto Typing:   ${flag(config.autoTyping)}\n` +
                `│ 📝 Auto Bio:      ${flag(config.autoBio)}\n` +
                `│ 🎭 Auto Sticker:  ${flag(config.autoSticker)}\n` +
                `│ ⬇️ Auto Download: ${flag(config.autoDownload)}\n` +
                `│ 👁️ Read Receipts: *${readReceipts}*\n` +
                `└─────────────────────\n\n` +

                `👁️ *Status Automations*\n` +
                `┌─────────────────────\n` +
                `│ 👁️ Auto View Status:   ${flag(asvEnabled)}\n` +
                `│ 💬 Auto React Status:  ${flag(asvReact)}${asvReact ? ` ┄ ${asvEmoji}` : ''}\n` +
                `│ 🗑️ Anti Delete Status: ${flag(antideleteStatus)}\n` +
                `└─────────────────────\n\n` +

                `🛡️ *Bot Protections*\n` +
                `┌─────────────────────\n` +
                `│ 🐛 Anti Bug:    ${flag(antibug)}${antibug ? ` ┄ _${antibugAction}_` : ''}\n` +
                `│ 🗑️ Anti Delete: *${antideleteMode}*\n` +
                `│ ✏️ Anti Edit:   *${antieditMode}*\n` +
                `└─────────────────────\n\n` +

                `🎨 *Display*\n` +
                `┌─────────────────────\n` +
                `│ 📋 Menu Style: *${menuStyle}*\n` +
                `│ 🔤 Font Style: *${fontStyle}*\n` +
                `└─────────────────────`;

            /* ══════════════════════════════════════════════
               GROUP SETTINGS SECTION
            ══════════════════════════════════════════════ */
            let gs = {};
            let groupName = 'N/A ┄ _run in a group for live values_';

            if (isGroup) {
                gs = database.getGroupSettings(chatId);
                try {
                    const meta = await sock.groupMetadata(chatId);
                    groupName  = meta?.subject || 'This Group';
                } catch (_) { groupName = 'This Group'; }
            } else {
                gs = config.defaultGroupSettings || {};
            }

            const act = (key) => gs[key] ? ` ┄ _${gs[key]}_` : '';

            const groupSection =
                `╔══════════════════════╗\n` +
                `  🏘️ *Group Settings*\n` +
                `  📍 ${groupName}\n` +
                `╚══════════════════════╝\n\n` +

                `🛡️ *Content Filters*\n` +
                `┌─────────────────────\n` +
                `│ ${flag(gs.antilink)}  Antilink${act('antilinkAction')}\n` +
                `│ ${flag(gs.antitag)}  Antitag${act('antitagAction')}\n` +
                `│ ${flag(gs.antiimage)}  Anti Image${act('antiimageAction')}\n` +
                `│ ${flag(gs.antisticker)}  Anti Sticker${act('antistickerAction')}\n` +
                `│ ${flag(gs.antiaudio)}  Anti Audio${act('antiaudioAction')}\n` +
                `│ ${flag(gs.antigif)}  Anti GIF${act('antigifAction')}\n` +
                `│ ${flag(gs.anticontact)}  Anti Contact${act('anticontactAction')}\n` +
                `│ ${flag(gs.antibadword)}  Anti Bad Word${act('antibadwordAction')}\n` +
                `│ ${flag(gs.antiviewonce)}  Anti View Once\n` +
                `│ ${flag(gs.antiforward)}  Anti Forward\n` +
                `└─────────────────────\n\n` +

                `🚫 *Anti-Abuse*\n` +
                `┌─────────────────────\n` +
                `│ ${flag(gs.antibot)}  Anti Bot\n` +
                `│ ${flag(gs.anticall)}  Anti Call${act('anticallAction')}\n` +
                `│ ${flag(gs.antiall)}  Anti All\n` +
                `│ ${flag(gs.antigroupmention)}  Anti Group Mention${act('antigroupmentionAction')}\n` +
                `│ ${flag(gs.antigroupstatus)}  Anti Group Status${act('antigroupstatusAction')}\n` +
                `│ ${flag(gs.antiSpam)}  Anti Spam${gs.antiSpam ? ` ┄ _${gs.antiSpamLimit || 5} msgs/${gs.antiSpamWindow || 5}s → ${gs.antiSpamAction || 'delete'}_` : ''}\n` +
                `│ ${flag(gs.antidelete)}  Anti Delete\n` +
                `│ ${flag(gs.antivideo)}  Anti Video\n` +
                `│ ${flag(gs.antidemote)}  Anti Demote\n` +
                `│ ${flag(gs.antipromote)}  Anti Promote\n` +
                `│ ${flag(gs.antikickall)}  Anti Kick All\n` +
                `└─────────────────────\n\n` +

                `👋 *Welcome & Goodbye*\n` +
                `┌─────────────────────\n` +
                `│ ${flag(gs.welcome)}  Welcome${gs.welcomeNoPP ? ' ┄ _no-pp fallback on_' : ''}\n` +
                `│ ${flag(gs.goodbye)}  Goodbye\n` +
                `└─────────────────────\n\n` +

                `🤖 *Group Features*\n` +
                `┌─────────────────────\n` +
                `│ ${flag(gs.chatbot)}  Chatbot\n` +
                `│ ${flag(gs.autosticker)}  Auto Sticker\n` +
                `│ ${flag(gs.nsfw)}  NSFW\n` +
                `│ ${flag(gs.detect)}  Detect\n` +
                `└─────────────────────`;

            const text = botSection + '\n\n' + groupSection;

            await sendButtons(sock, chatId, { text, footer, buttons }, { quoted: msg });

        } catch (error) {
            console.error('getsettings error:', error);
            await extra.reply(`❌ Error: ${error.message}`);
        }
    }
};
