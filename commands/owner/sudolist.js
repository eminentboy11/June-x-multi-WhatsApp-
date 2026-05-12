const database = require('../../database');
const config = require('../../config');

module.exports = {
    name: 'sudolist',
    aliases: ['modlist', 'listsudo', 'sudos'],
    category: 'owner',
    description: 'List all sudo (moderator) users',
    usage: '.sudolist',
    ownerOnly: true,

    async execute(sock, msg, args, extra) {
        const { from, reply } = extra;

        const mods = database.getModerators();

        if (!mods || mods.length === 0) {
            return reply('📭 No sudo users have been added yet.\n\nUse *.addsudo* to add one.');
        }

        const list = mods.map((num, i) => `${i + 1}. @${num}`).join('\n');
        const mentions = mods.map(num => `${num}@s.whatsapp.net`);

        await sock.sendMessage(from, {
            text: `👑 *Sudo Users (${mods.length})*\n\n${list}\n\n_These users can run moderator-level commands._`,
            mentions
        }, { quoted: msg });
    }
};
