const { getMode, setMode } = require(require('path').join(global.__CORE__, 'utils', 'presenceSettings'));

module.exports = {
    name: 'autorecording',
    aliases: ['autorecord', 'fakerecord'],
    category: 'owner',
    description: 'Show fake audio-recording presence before every bot response',
    usage: '.autorecording on/off',
    ownerOnly: true,

    async execute(sock, msg, args, extra) {
        const sub     = (args[0] || '').toLowerCase();
        const current = getMode();

        if (!sub) {
            return extra.reply(
                `🎙️ *Auto Recording*\n` +
                `━━━━━━━━━━━━━━━\n` +
                `Status: *${current === 'recording' ? '✅ ON' : '❌ OFF'}*\n\n` +
                `When ON the bot shows a _"recording…"_ presence indicator before every response.\n\n` +
                `  .autorecording on\n` +
                `  .autorecording off`
            );
        }

        if (sub === 'on') {
            setMode('recording');
            return extra.reply('✅ *Auto Recording* enabled — bot will show _recording…_ before responses.\n_Disables typing & record+type modes._');
        }

        if (sub === 'off') {
            if (current === 'recording') setMode('off');
            return extra.reply('❌ *Auto Recording* disabled.');
        }

        return extra.reply('⚠️ Usage: .autorecording on/off');
    }
};
