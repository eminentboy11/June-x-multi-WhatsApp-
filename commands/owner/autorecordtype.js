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
    name: 'autorecordtype',
    aliases: ['recordtype', 'fakerecordtype'],
    category: 'owner',
    description: 'Show fake recording then typing presence before every bot response',
    usage: '.autorecordtype on/off',
    ownerOnly: true,

    async execute(sock, msg, args, extra) {
        const sub = (args[0] || '').toLowerCase();

        if (!sub) {
            return extra.reply(
                `🎙️⌨️ *Auto Record + Type*\n` +
                `━━━━━━━━━━━━━━━\n` +
                `Status: *${config.autoRecordType ? '✅ ON' : '❌ OFF'}*\n\n` +
                `When ON the bot briefly shows _"recording…"_ then switches to _"typing…"_ before responding — looks very natural.\n\n` +
                `  .autorecordtype on\n` +
                `  .autorecordtype off`
            );
        }

        if (sub === 'on') {
            saveConfigKey('autoRecordType', true);
            // Turn off conflicting presences
            if (config.autoRecording) saveConfigKey('autoRecording', false);
            if (config.autoTyping)    saveConfigKey('autoTyping', false);
            return extra.reply('✅ *Auto Record+Type* enabled — bot will show _recording → typing_ before responses.');
        }

        if (sub === 'off') {
            saveConfigKey('autoRecordType', false);
            return extra.reply('❌ *Auto Record+Type* disabled.');
        }

        return extra.reply('⚠️ Usage: .autorecordtype on/off');
    }
};
