const { runPresenceCommand } = require('../../utils/presenceSettings');

module.exports = {
    name: 'autorecording',
    aliases: ['autorecord', 'record'],
    category: 'owner',
    description: 'Show fake audio-recording presence, scoped to pm/group/all',
    usage: '.autorecording pm|group|all|on|off',
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
