const { runPresenceCommand } = require('../../utils/presenceSettings');

module.exports = {
    name: 'autorecordtype',
    aliases: ['recordtype', 'fakerecordtype'],
    category: 'owner',
    description: 'Show fake recording-then-typing presence, scoped to pm/group/all',
    usage: '.autorecordtype pm|group|all|on|off',
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
