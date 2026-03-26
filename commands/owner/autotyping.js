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
                `━━━━━━━━━━━━━━━\n` +
                `Status: *${current === 'typing' ? '✅ ON' : '❌ OFF'}*\n\n` +
                `When ON the bot shows a _"typing…"_ indicator before every response.\n\n` +
                `  .autotyping on\n` +
                `  .autotyping off`
            );
        }

        if (sub === 'on') {
            setMode('typing');
            return extra.reply('✅ *Auto Typing* enabled — bot will show _typing…_ before responses.\n_Disables recording & record+type modes._');
        }

        if (sub === 'off') {
            if (current === 'typing') setMode('off');
            return extra.reply('❌ *Auto Typing* disabled.');
        }

        return extra.reply('⚠️ Usage: .autotyping on/off');
    }
};
