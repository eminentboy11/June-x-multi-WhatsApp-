const database = require(require('path').join(global.__CORE__, 'database'));

const VALID_ACTIONS = ['promote', 'demote', 'kick', 'warn', 'add', 'tagall', 'mute'];

module.exports = {
  name: 'setsticker',
  aliases: ['stickeraction', 'stickertrigger'],
  category: 'admin',
  description: 'Set a sticker to trigger a group action when sent',
  usage: '.setsticker <promote/demote/kick/warn/add/tagall/mute> — reply to a sticker\n.setsticker list\n.setsticker clear <action>',
  groupOnly: true,
  adminOnly: true,

  async execute(sock, msg, args, extra) {
    try {
      const sub = args[0]?.toLowerCase();

      if (!sub) {
        return extra.reply(
          `🎭 *Set Sticker Trigger*\n━━━━━━━━━━━━━━━\n\n` +
          `Reply to a sticker with:\n` +
          `*.setsticker <action>*\n\n` +
          `*Actions:*\n` +
          VALID_ACTIONS.map(a => `  • ${a}`).join('\n') +
          `\n\n*Other commands:*\n` +
          `  .setsticker list\n` +
          `  .setsticker clear <action>`
        );
      }

      const groupSettings = database.getGroupSettings(extra.from);
      const stickerActions = groupSettings.stickerActions || {};

      if (sub === 'list') {
        const entries = Object.entries(stickerActions);
        if (!entries.length) return extra.reply('📋 No sticker triggers set for this group.');
        const lines = entries.map(([action]) => `  • *${action}* → sticker set ✅`).join('\n');
        return extra.reply(`📋 *Sticker Triggers*\n━━━━━━━━━━━━━━━\n\n${lines}`);
      }

      if (sub === 'clear') {
        const target = args[1]?.toLowerCase();
        if (!target || !VALID_ACTIONS.includes(target)) {
          return extra.reply(`❌ Specify a valid action to clear:\n${VALID_ACTIONS.join(', ')}`);
        }
        if (!stickerActions[target]) {
          return extra.reply(`❌ No sticker trigger set for *${target}*.`);
        }
        delete stickerActions[target];
        database.updateGroupSettings(extra.from, { stickerActions });
        return extra.reply(`✅ Sticker trigger for *${target}* cleared.`);
      }

      if (!VALID_ACTIONS.includes(sub)) {
        return extra.reply(`❌ Invalid action. Valid actions:\n${VALID_ACTIONS.join(', ')}`);
      }

      const ctx = msg.message?.extendedTextMessage?.contextInfo;
      const quotedSticker = ctx?.quotedMessage?.stickerMessage;

      if (!quotedSticker) {
        return extra.reply('❌ Please *reply to a sticker* to set it as the trigger!');
      }

      const raw = quotedSticker.fileSha256;
      if (!raw) return extra.reply('❌ Could not read sticker fingerprint. Try a different sticker.');

      const stickerHash = Buffer.isBuffer(raw)
        ? raw.toString('base64')
        : Buffer.from(Object.values(raw)).toString('base64');

      stickerActions[sub] = stickerHash;
      database.updateGroupSettings(extra.from, { stickerActions });

      return extra.reply(
        `✅ *Sticker trigger set!*\n\n` +
        `⚡ Action: *${sub}*\n` +
        `_When this sticker is sent in the group, the *${sub}* action will be applied to the sender._`
      );

    } catch (error) {
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};
