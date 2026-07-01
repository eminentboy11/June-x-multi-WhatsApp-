const { getMode, setMode } = require('../../utils/presenceSettings');

module.exports = {
    name: 'autotyping',
    aliases: ['autotext', 'faketyping'],
    category: 'owner',
    description: 'Show fake typing presence before every bot response',
    usage: '.autotyping on/off',
    ownerOnly: true,

    async execute(sock, msg, args, extra) {
        const sub     = (args[0] || '').toLowerCase();
        const current = getMode();

        if (!sub) {
            return extra.reply(
                `⌨️ *Auto Typing*\n` +
                `Status: *${current === 'typing' ? '🟢 ON' : '🔴 OFF'}*\n\n` +
                `.autotyping on\n` +
                `.autotyping off`
            );
        }

        if (sub === 'on') {
            setMode('typing');
            return extra.reply('✅ Auto Typing turned ON');
        }

        if (sub === 'off') {
            if (current === 'typing') setMode('off');
            return extra.reply('❌ Auto Typing turned OFF');
        }

        return extra.reply('⚠️ Usage: .autotyping on/off');
    }
};
