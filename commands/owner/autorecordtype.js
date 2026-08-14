const { runPresenceCommand } = require('../../utils/presenceSettings');

module.exports = {
    name: 'autorecordtype',
    aliases: ['recordtype', 'fakerecordtype'],
    category: 'owner',
    description: 'Show fake recording-then-typing presence — pm = PM only, gc = groups only, all = both, off = disabled',
    usage: '.autorecordtype pm|gc|all|off',
    ownerOnly: true,

    async execute(sock, msg, args, extra) {
        return runPresenceCommand({
            name: 'autorecordtype',
            mode: 'recordtype',
            args,
            extra,
            emoji: '🎙️⌨️',
            label: 'Auto Record+Type',
        });
    }
};
