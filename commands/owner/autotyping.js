const { runPresenceCommand } = require('../../utils/presenceSettings');

module.exports = {
    name: 'autotyping',
    aliases: ['autotext', 'faketyping'],
    category: 'owner',
    description: 'Show fake typing presence — pm = PM only, gc = groups only, all = both, off = disabled',
    usage: '.autotyping pm|gc|all|off',
    ownerOnly: true,

    async execute(sock, msg, args, extra) {
        return runPresenceCommand({
            name: 'autotyping',
            mode: 'typing',
            args,
            extra,
            emoji: '⌨️',
            label: 'Auto Typing',
        });
    }
};
