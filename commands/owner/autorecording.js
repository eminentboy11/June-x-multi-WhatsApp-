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
        // Insert before closing brace of top-level exports
        src = src.replace(/(autoDownload:\s*(?:true|false))/, `$1,\n    ${key}: ${value}`);
    }
    fs.writeFileSync(configPath, src);
    config[key] = value;
}

module.exports = {
    name: 'autorecording',
    aliases: ['autorecord', 'fakerecord'],
    category: 'owner',
    description: 'Show fake audio-recording presence before every bot response',
    usage: '.autorecording on/off',
    ownerOnly: true,

    async execute(sock, msg, args, extra) {
        const sub = (args[0] || '').toLowerCase();

        if (!sub) {
            return extra.reply(
                `🎙️ *Auto Recording*\n` +
                `━━━━━━━━━━━━━━━\n` +
                `Status: *${config.autoRecording ? '✅ ON' : '❌ OFF'}*\n\n` +
                `When ON the bot shows a _"recording…"_ presence indicator before every response, making it look like it's sending a voice note.\n\n` +
                `  .autorecording on\n` +
                `  .autorecording off`
            );
        }

        if (sub === 'on') {
            saveConfigKey('autoRecording', true);
            // Turn off conflicting presences
            if (config.autoRecordType) saveConfigKey('autoRecordType', false);
            if (config.autoTyping)     saveConfigKey('autoTyping', false);
            return extra.reply('✅ *Auto Recording* enabled — bot will show _recording…_ before responses.');
        }

        if (sub === 'off') {
            saveConfigKey('autoRecording', false);
            return extra.reply('❌ *Auto Recording* disabled.');
        }

        return extra.reply('⚠️ Usage: .autorecording on/off');
    }
};
