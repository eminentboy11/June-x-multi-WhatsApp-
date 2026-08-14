const { runPresenceCommand } = require('../../utils/presenceSettings');

module.exports = {
    name: 'autotyping',
    aliases: ['autotext', 'faketyping'],
    category: 'owner',
    description: 'Show fake typing presence, scoped to pm/group/all',
    usage: '.autotyping pm|group|all|on|off',
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
