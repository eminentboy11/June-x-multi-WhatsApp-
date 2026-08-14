const { runPresenceCommand } = require('../../utils/presenceSettings');

module.exports = {
    name: 'autorecording',
    aliases: ['autorecord', 'record'],
    category: 'owner',
    description: 'Show fake audio-recording presence — pm = PM only, gc = groups only, all = both, off = disabled',
    usage: '.autorecording pm|gc|all|off',
    ownerOnly: true,

    async execute(sock, msg, args, extra) {
        return runPresenceCommand({
            name: 'autorecording',
            mode: 'recording',
            args,
            extra,
            emoji: '🎙️',
            label: 'Auto Recording',
        });
    }
};
