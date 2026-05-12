const { getMode, setMode } = require('../../utils/presenceSettings');

module.exports = {
    name: 'autorecordtype',
    aliases: ['recordtype', 'fakerecordtype'],
    category: 'owner',
    description: 'Show fake recording then typing presence before every bot response',
    usage: '.autorecordtype on/off',
    ownerOnly: true,

    async execute(sock, msg, args, extra) {
        const sub     = (args[0] || '').toLowerCase();
        const current = getMode();

        if (!sub) {
            return extra.reply(
                `🎙️⌨️ *Auto Record + Type*\n` +
                `━━━━━━━━━━━━━━━\n` +
                `Status: *${current === 'recordtype' ? '✅ ON' : '❌ OFF'}*\n\n` +
                `When ON the bot briefly shows _"recording…"_ then switches to _"typing…"_ before responding.\n\n` +
                `  .autorecordtype on\n` +
                `  .autorecordtype off`
            );
        }

        if (sub === 'on') {
            setMode('recordtype');
            return extra.reply('✅ *Auto Record+Type* enabled — bot will show _recording → typing_ before responses.\n_Disables typing & recording-only modes._');
        }

        if (sub === 'off') {
            if (current === 'recordtype') setMode('off');
            return extra.reply('❌ *Auto Record+Type* disabled.');
        }

        return extra.reply('⚠️ Usage: .autorecordtype on/off');
    }
};
