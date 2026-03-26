const fs   = require('fs');
const path = require('path');
const config = require('../../config');

const configPath = path.join(__dirname, '../../config.js');

function saveConfigKey(key, value) {
    let src = fs.readFileSync(configPath, 'utf-8');
    const regex = new RegExp(`(${key}:\\s*)(true|false)`);
    if (regex.test(src)) {
        src = src.replace(regex, `$1${value}`);
    } else {
        src = src.replace(/(autoDownload:\s*(?:true|false))/, `$1,\n    ${key}: ${value}`);
    }
    fs.writeFileSync(configPath, src);
    config[key] = value;
}

module.exports = {
    name: 'autotyping',
    aliases: ['autotext', 'faketyping'],
    category: 'owner',
    description: 'Show fake typing presence before every bot response',
    usage: '.autotyping on/off',
    ownerOnly: true,

    async execute(sock, msg, args, extra) {
        const sub = (args[0] || '').toLowerCase();

        if (!sub) {
            return extra.reply(
                `⌨️ *Auto Typing*\n` +
                `━━━━━━━━━━━━━━━\n` +
                `Status: *${config.autoTyping ? '✅ ON' : '❌ OFF'}*\n\n` +
                `When ON the bot shows a _"typing…"_ indicator before every response.\n\n` +
                `  .autotyping on\n` +
                `  .autotyping off`
            );
        }

        if (sub === 'on') {
            saveConfigKey('autoTyping', true);
            if (config.autoRecording)  saveConfigKey('autoRecording', false);
            if (config.autoRecordType) saveConfigKey('autoRecordType', false);
            return extra.reply('✅ *Auto Typing* enabled — bot will show _typing…_ before responses.');
        }

        if (sub === 'off') {
            saveConfigKey('autoTyping', false);
            return extra.reply('❌ *Auto Typing* disabled.');
        }

        return extra.reply('⚠️ Usage: .autotyping on/off');
    }
};
