const { getMode, setMode } = require('../../utils/presenceSettings');

module.exports = {
    name: 'autorecording',
    aliases: ['autorecord', 'record'],
    category: 'owner',
    description: 'Show fake audio-recording presence before every bot response',
    usage: '.autorecording on/off',
    ownerOnly: true,

    async execute(sock, msg, args, extra) {
        const sub     = (args[0] || '').toLowerCase();
        const current = getMode();

        if (!sub) {
            return extra.reply(`🎙️ Auto Recording: *${current === 'recording' ? '✅ ON' : '❌ OFF'}*\n\nUsage: .autorecording on/off`);
        }

        if (sub === 'on') {
            setMode('recording');
            return extra.reply('🎙️ Auto Recording set to *ON*');
        }

        if (sub === 'off') {
            if (current === 'recording') setMode('off');
            return extra.reply('🎙️ Auto Recording set to *OFF*');
        }

        return extra.reply('⚠️ Usage: .autorecording on/off');
    }
};
