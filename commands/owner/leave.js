/**
 * Leave Command
 * Makes the bot leave the current group
 * Owner/Sudo only to prevent abuse
 */

module.exports = {
    name: 'leave',
    aliases: ['left', 'bye'],
    category: 'admin',
    description: 'Make the bot leave the current group',
    usage: '.leave',
    groupOnly: true,
    ownerOnly: true,

    async execute(sock, msg, args, extra) {
        try {
            await extra.reply('👋 Goodbye everyone! Leaving the group now...');
            await sock.groupLeave(extra.from);
        } catch (error) {
            console.error('Leave command error:', error);
            await extra.reply('❌ Failed to leave the group.');
        }
    }
};
