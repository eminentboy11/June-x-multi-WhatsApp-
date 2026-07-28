/**
 * Settings — flat list showing every setting's current live value.
 */
const fs   = require('fs');
const path = require('path');
const { sendButtons } = require('gifted-btns');
const config   = require('../../config');
const database = require('../../database');

const on  = '✅ ON';
const off = '❌ OFF';
const flag = (v) => (v ? on : off);

function readJson(filePath) {
    try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
    catch { return {}; }
}

module.exports = {
    name: 'getsettings',
    aliases: ['settings', 'gsettings', 'setup', 'howtoset'],
    category: 'general',
    description: 'Shows the current value of every bot and group setting',
    usage: '.settings',

    async execute(sock, msg, args, extra) {
        try {
            const chatId  = extra.from;
            const isGroup = chatId.endsWith('@g.us');
            const p       = config.prefix || '.';
            const footer  = `> ᴘᴏᴡᴇʀᴇᴅ ʙʏ ${config.botName}`;

            const ownerNums   = [].concat(config.ownerNumber || []).map(n => String(n).replace(/\D/g, '')).filter(Boolean);
            const ownerDigits = ownerNums[0] || '';
            const ownerName   = Array.isArray(config.ownerName) ? config.ownerName[0] : (config.ownerName || 'N/A');

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

            // ── Read all live bot settings ─────────────────────────────────────

            let botMode = '🌐 Public';
            try { botMode = require('../../utils/botMode').getModeLabel(); } catch (_) {}

            let presenceMode = 'off';
            try { presenceMode = require('../../utils/presenceSettings').getMode(); } catch (_) {}
            const presenceLabel = { typing: '⌨️ typing', recording: '🎙️ recording', recordtype: '🎙️⌨️ record+type', off: 'off' }[presenceMode] || presenceMode;

            const autoReadMode   = database.getBotSetting('autoReadMode')   || 'off';
            const autoReact      = database.getBotSetting('autoReact')      || false;
            const autoReactMode  = database.getBotSetting('autoReactMode')  || 'bot';
            const alwaysOnline   = database.getBotSetting('alwaysOnline')   || false;
            const selfMode       = database.getBotSetting('selfMode')       || false;
            const autoBio        = database.getBotSetting('autoBio')        || false;
            const autoDownload   = database.getBotSetting('autoDownload')   || false;
            const menuStyle      = database.getBotSetting('menuStyle')      || '1';
            const fontStyle      = database.getBotSetting('fontStyle')      || 'normal';

            // Read receipts
            const readReceiptsVal = database.getBotSetting('readReceipts') || 'off';
            const rrLabel = { off: '🔵 off (blue ticks)', on: '⚪ on (grey ticks)', contacts: '👥 contacts only' }[readReceiptsVal] || readReceiptsVal;

            // Status automations
            const s          = database.loadSettings ? database.loadSettings() : {};
            const asvEnabled = s.enabled   ?? database.getBotSetting('autoStatusView')        ?? false;
            const asvReact   = s.react     ?? database.getBotSetting('autoStatusReact')       ?? false;
            const asvEmoji   = s.emoji     ?? database.getBotSetting('autoStatusEmoji')       ?? '💙';
            const asvPool    = s.emojiPool ?? database.getBotSetting('autoStatusEmojiPool')   ?? [];
            const asvRandom  = s.randomEmoji ?? database.getBotSetting('autoStatusRandomEmoji') ?? false;

            const emojiDisplay = asvRandom && asvPool.length
                ? `random pool: ${asvPool.join(' ')}`
                : asvEmoji;

            // Bot protections
            const antibug       = database.getBotSetting('antibug')       || false;
            const antibugAction = database.getBotSetting('antibugAction') || 'delete';

            const antideleteData  = readJson(path.join(__dirname, '../../data/antidelete.json'));
            const antideleteMode  = antideleteData['_global']?.mode || 'off';
            const antieditData    = readJson(path.join(__dirname, '../../data/antiedit.json'));
            const antieditMode    = antieditData.mode || 'off';
            const antidelStData   = readJson(path.join(__dirname, '../../data/antideletestatus.json'));
            const antidelStOn     = antidelStData.enabled === true;

            const anticallOn     = database.getBotSetting('anticall')      || false;
            const anticallAction = database.getBotSetting('anticallAction') || 'decline';

            // ── Build flat bot settings list ──────────────────────────────────

            let text =
                `*CURRENT BOT SETTINGS*\n\n` +

                `🔹 *prefix* : ${p}\n` +
                `🔹 *owner* : ${ownerName}\n` +
                `🔹 *timezone* : ${config.timezone || 'Africa/Nairobi'}\n` +
                `🔹 *botname* : ${config.botName}\n` +
                `🔹 *botmode* : ${botMode}\n` +
                `🔹 *selfmode* : ${flag(selfMode)}\n` +
                `🔹 *alwaysonline* : ${flag(alwaysOnline)}\n` +
                `🔹 *presence* : ${presenceLabel}\n` +
                `🔹 *readreceipts* : ${rrLabel}\n` +
                `🔹 *autoread* : ${autoReadMode}\n` +
                `🔹 *autoreact* : ${flag(autoReact)}${autoReact ? ` — ${autoReactMode}` : ''}\n` +
                `🔹 *autobio* : ${flag(autoBio)}\n` +
                `🔹 *autodownload* : ${flag(autoDownload)}\n` +
                `🔹 *autostatusview* : ${flag(asvEnabled)}\n` +
                `🔹 *autostatusreact* : ${flag(asvReact)}\n` +
                `🔹 *autostatusemoji* : ${emojiDisplay}\n` +
                `🔹 *antideletestatus* : ${flag(antidelStOn)}\n` +
                `🔹 *antibug* : ${flag(antibug)}${antibug ? ` — ${antibugAction}` : ''}\n` +
                `🔹 *antidelete* : ${antideleteMode}\n` +
                `🔹 *antiedit* : ${antieditMode}\n` +
                `🔹 *anticall* : ${flag(anticallOn)}${anticallOn ? ` — ${anticallAction}` : ''}\n` +
                `🔹 *menustyle* : ${menuStyle}\n` +
                `🔹 *fontstyle* : ${fontStyle}\n`;

            // ── Group settings (only when run in a group) ─────────────────────

            if (isGroup) {
                let groupName = 'This Group';
                try {
                    const meta = await sock.groupMetadata(chatId);
                    groupName  = meta?.subject || 'This Group';
                } catch (_) {}

                const gs  = database.getGroupSettings(chatId);
                const act = (key) => gs[key] ? ` — ${gs[key]}` : '';

                text +=
                    `\n*GROUP: ${groupName}*\n\n` +

                    `🔹 *antilink* : ${flag(gs.antilink)}${act('antilinkAction')}\n` +
                    `🔹 *antitag* : ${flag(gs.antitag)}${act('antitagAction')}\n` +
                    `🔹 *antiimage* : ${flag(gs.antiimage)}${act('antiimageAction')}\n` +
                    `🔹 *antisticker* : ${flag(gs.antisticker)}${act('antistickerAction')}\n` +
                    `🔹 *antiaudio* : ${flag(gs.antiaudio)}${act('antiaudioAction')}\n` +
                    `🔹 *antigif* : ${flag(gs.antigif)}${act('antigifAction')}\n` +
                    `🔹 *anticontact* : ${flag(gs.anticontact)}${act('anticontactAction')}\n` +
                    `🔹 *antibadword* : ${flag(gs.antibadword)}${act('antibadwordAction')}\n` +
                    `🔹 *antiviewonce* : ${flag(gs.antiviewonce)}\n` +
                    `🔹 *antiforward* : ${flag(gs.antiforward)}\n` +
                    `🔹 *antibot* : ${flag(gs.antibot)}\n` +
                    `🔹 *antiall* : ${flag(gs.antiall)}\n` +
                    `🔹 *antivideo* : ${flag(gs.antivideo)}\n` +
                    `🔹 *antidemote* : ${flag(gs.antidemote)}\n` +
                    `🔹 *antipromote* : ${flag(gs.antipromote)}\n` +
                    `🔹 *antikickall* : ${flag(gs.antikickall)}\n` +
                    `🔹 *antigroupmention* : ${flag(gs.antigroupmention)}${act('antigroupmentionAction')}\n` +
                    `🔹 *antigroupstatus* : ${flag(gs.antigroupstatus)}${act('antigroupstatusAction')}\n` +
                    `🔹 *antispam* : ${flag(gs.antiSpam)}${gs.antiSpam ? ` — ${gs.antiSpamLimit || 5} msgs/${gs.antiSpamWindow || 5}s → ${gs.antiSpamAction || 'delete'}` : ''}\n` +
                    `🔹 *antidelete (group)* : ${flag(gs.antidelete)}\n` +
                    `🔹 *welcome* : ${flag(gs.welcome)}\n` +
                    `🔹 *goodbye* : ${flag(gs.goodbye)}\n` +
                    `🔹 *chatbot* : ${flag(gs.chatbot)}\n` +
                    `🔹 *autosticker* : ${flag(gs.autosticker)}\n` +
                    `🔹 *nsfw* : ${flag(gs.nsfw)}\n`;
            }

            await sendButtons(sock, chatId, { text, footer, buttons }, { quoted: msg });

        } catch (error) {
            console.error('getsettings error:', error);
            await extra.reply(`❌ Error: ${error.message}`);
        }
    }
};
