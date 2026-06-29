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
            return extra.reply(`🎙️⌨️ Auto Record+Type: *${current === 'recordtype' ? '✅ ON' : '❌ OFF'}*\n\nUsage: .autorecordtype on/off`);
        }

        if (sub === 'on') {
            setMode('recordtype');
            return extra.reply('🎙️⌨️ Auto Record+Type set to *ON*');
        }

        if (sub === 'off') {
            if (current === 'recordtype') setMode('off');
            return extra.reply('🎙️⌨️ Auto Record+Type set to *OFF*');
        }

        return extra.reply('⚠️ Usage: .autorecordtype on/off');
    }
};
