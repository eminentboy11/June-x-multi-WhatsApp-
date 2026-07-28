/**
 * Settings Guide — flat reference list of every configurable bot setting.
 */
const { sendButtons } = require('gifted-btns');
const config = require('../../config');

module.exports = {
    name: 'getsettings',
    aliases: ['settings', 'gsettings', 'setup', 'howtoset'],
    category: 'general',
    description: 'Shows how to configure every setting and command on the bot',
    usage: '.settings',

    async execute(sock, msg, args, extra) {
        try {
            const chatId = extra.from;
            const p      = config.prefix || '.';
            const owner  = Array.isArray(config.ownerName) ? config.ownerName[0] : (config.ownerName || 'Supreme');
            const tz     = config.timezone || 'Africa/Nairobi';
            const footer = `> ᴘᴏᴡᴇʀᴇᴅ ʙʏ ${config.botName}`;

            const ownerDigits = [].concat(config.ownerNumber || [])
                .map(n => String(n).replace(/\D/g, ''))
                .filter(Boolean)[0] || '';

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

            const text =
`*⚙️ BOT SETTINGS GUIDE*

🔹 *prefix* : \`${p}\`
   Set: \`${p}setprefix .\`

🔹 *owner* : ${owner}
   _(Edit config.js → ownerName / ownerNumber)_

🔹 *timezone* : ${tz}
   _(Edit config.js → timezone)_
   e.g. Africa/Nairobi · Asia/Kolkata · America/New_York

🔹 *botname* : ${config.botName}
   _(Edit config.js → botName)_

🔹 *selfmode* : \`${p}selfmode on/off\`

🔹 *botmode* : \`${p}botmode public/private/groups\`

🔹 *alwaysonline* : \`${p}alwaysonline on/off\`

🔹 *readreceipts* : \`${p}readreceipts off\` → 🔵 blue ticks _(default)_
   \`${p}readreceipts on\` → ⚪ grey ticks
   \`${p}readreceipts contacts\` → blue for contacts only

🔹 *autoread* : \`${p}autoread on/off\`
   Modes: \`${p}autoread all/pm/groups\`

🔹 *autoreact* : \`${p}autoreact on/off\`
   Modes: \`${p}autoreact bot/all\`

🔹 *presence* : \`${p}presence typing/recording/off\`

🔹 *autobio* : \`${p}autobio on/off\`

🔹 *autodownload* : \`${p}autodownload on/off\`

🔹 *autostatusview* : \`${p}autostatusview on/off\`

🔹 *autostatusreact* : \`${p}autostatusreact on/off\`

🔹 *autostatusemoji* : \`${p}autostatusemoji 💙\` _(single)_
   \`${p}autostatusemoji 💙,✅,😂,🥰\` _(random pool)_

🔹 *antideletestatus* : \`${p}antideletestatus on/off\`

🔹 *antibug* : \`${p}antibug on/off\`
   \`${p}antibug on delete/kick/warn\`

🔹 *antidelete* : \`${p}antidelete on/off\`
   Modes: \`${p}antidelete all/pm/groups\`

🔹 *antiedit* : \`${p}antiedit on/off\`

🔹 *anticall* : \`${p}anticall on/off\`
   \`${p}anticall decline/block\`

🔹 *viewonce* : reply to a view-once → \`${p}viewonce\`

🔹 *antilink* : \`${p}antilink on/off\`
   Actions: delete · warn · kick

🔹 *antitag* : \`${p}antitag on/off\`

🔹 *antiimage* : \`${p}antiimage on/off\`

🔹 *antisticker* : \`${p}antisticker on/off\`

🔹 *antiaudio* : \`${p}antiaudio on/off\`

🔹 *antigif* : \`${p}antigif on/off\`

🔹 *anticontact* : \`${p}anticontact on/off\`

🔹 *antibadword* : \`${p}antibadword on/off\`
   Add words: \`${p}antibadword add word1 word2\`

🔹 *antiviewonce* : \`${p}antiviewonce on/off\`

🔹 *antiforward* : \`${p}antiforward on/off\`

🔹 *antibot* : \`${p}antibot on/off\`

🔹 *antiall* : \`${p}antiall on/off\`

🔹 *antivideo* : \`${p}antivideo on/off\`

🔹 *antidemote* : \`${p}antidemote on/off\`

🔹 *antipromote* : \`${p}antipromote on/off\`

🔹 *antikickall* : \`${p}antikickall on/off\`

🔹 *antigroupmention* : \`${p}antigroupmention on/off\`

🔹 *antigroupstatus* : \`${p}antigroupstatus on/off\`

🔹 *antispam* : \`${p}antispam on/off\`
   \`${p}antispam 5 5 delete\` _(msgs / secs / action)_

🔹 *welcome* : \`${p}welcome on/off\`
   Custom: \`${p}setwelcome your message\`

🔹 *goodbye* : \`${p}goodbye on/off\`
   Custom: \`${p}setgoodbye your message\`

🔹 *chatbot* : \`${p}chatbot on/off\`

🔹 *autosticker* : \`${p}autosticker on/off\`

🔹 *nsfw* : \`${p}nsfw on/off\`

🔹 *menustyle* : \`${p}setmenu 1\` / \`${p}setmenu 2\` … \`${p}setmenu 5\`

🔹 *menuimage* : reply to image → \`${p}setmenuimage\`
   Reset: \`${p}setmenuimage reset\`

🔹 *fontstyle* : \`${p}fontstyle\` _(lists styles)_
   \`${p}fontstyle 1\` / \`${p}fontstyle 2\` …`;

            await sendButtons(sock, chatId, { text, footer, buttons }, { quoted: msg });

        } catch (error) {
            console.error('getsettings error:', error);
            await extra.reply(`❌ Error: ${error.message}`);
        }
    }
};
