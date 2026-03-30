/**
 * Add Command
 * Add a member to the group by phone number
 * Usage: .add 254798570132
 */

module.exports = {
  name: 'add',
  aliases: [],
  category: 'admin',
  description: 'Add a member to the group by phone number',
  usage: '.add <number>  e.g. .add 254798570132',
  groupOnly: true,
  adminOnly: true,
  botAdminNeeded: true,

  async execute(sock, msg, args, extra) {
    try {
      if (!args || args.length === 0) {
        return extra.reply('📲 Please provide a phone number.\n\nExample: .add 254798570132');
      }

      const raw = args[0].replace(/[^0-9]/g, '');

      if (!raw || raw.length < 7) {
        return extra.reply('❌ Invalid phone number. Example: .add 254798570132');
      }

      const jid = `${raw}@s.whatsapp.net`;

      const result = await sock.groupParticipantsUpdate(extra.from, [jid], 'add');

      const status = result && result[0] && result[0].status;

      if (status === '200') {
        await sock.sendMessage(extra.from, {
          text: `✅ @${raw} has been added to the group!`,
          mentions: [jid]
        }, { quoted: msg });
      } else if (status === '403') {
        await extra.reply(`❌ Cannot add @${raw} — their privacy settings prevent being added to groups.`);
      } else if (status === '408') {
        await extra.reply(`❌ @${raw} is not registered on WhatsApp or the number is invalid.`);
      } else if (status === '409') {
        await extra.reply(`❌ @${raw} is already a member of this group.`);
      } else {
        await extra.reply(`❌ Failed to add ${raw}. Make sure the number is correct and I am an admin.`);
      }
    } catch (error) {
      console.error('Add command error:', error);
      await extra.reply('❌ Failed to add member. Make sure I am an admin and the number is valid.');
    }
  }
};
