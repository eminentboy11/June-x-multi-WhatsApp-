const database = require(require('path').join(global.__CORE__, 'database'));

const VALID_ACTIONS = ['promote', 'demote', 'kick', 'warn', 'add', 'tagall', 'mute'];

const ACTION_DESC = {
  promote: 'Promotes the quoted member to admin',
  demote:  'Demotes the quoted admin to member',
  kick:    'Removes the quoted member from the group',
  warn:    'Warns the quoted member (kicks on max warns)',
  add:     'Re-adds the quoted member to the group',
  tagall:  'Tags all group members',
  mute:    'Mutes the quoted member (bot ignores them)',
};

const WRAPPERS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
];

function resolveContent(message) {
  if (!message) return null;
  const top = Object.keys(message)[0];
  if (!top) return null;
  if (WRAPPERS.includes(top)) return message[top]?.message || null;
  return message;
}

function extractContextInfo(msg) {
  const content = resolveContent(msg.message);
  if (!content) return null;
  const top = Object.keys(content)[0];
  if (!top) return null;
  return content[top]?.contextInfo || null;
}

module.exports = {
  name: 'setsticker',
  aliases: ['stickeraction', 'stickertrigger'],
  category: 'admin',
  description: 'Set a sticker to trigger a group action on the quoted member when sent',
  usage: '.setsticker <action> — reply to a sticker\n.setsticker list\n.setsticker clear <action>',
  groupOnly: true,
  adminOnly: true,

  async execute(sock, msg, args, extra) {
    try {
      const sub = args[0]?.toLowerCase();

      if (!sub) {
        const actionLines = VALID_ACTIONS.map(a => `  • *${a}* — ${ACTION_DESC[a]}`).join('\n');
        return extra.reply(
          `🎭 *Set Sticker Trigger*\n━━━━━━━━━━━━━━━\n\n` +
          `Reply to a sticker with:\n` +
          `*.setsticker <action>*\n\n` +
          `When an admin sends that sticker as a reply to a member's message, the action is applied to the *quoted member*.\n\n` +
          `*Actions:*\n${actionLines}\n\n` +
          `*Other commands:*\n` +
          `  .setsticker list\n` +
          `  .setsticker clear <action>`
        );
      }

      const groupSettings = database.getGroupSettings(extra.from);
      const stickerActions = groupSettings.stickerActions || {};

      if (sub === 'list') {
        const entries = Object.entries(stickerActions);
        if (!entries.length) return extra.reply('📋 No sticker triggers set for this group.');
        const lines = entries.map(([action]) => `  • *${action}* → ${ACTION_DESC[action]} ✅`).join('\n');
        return extra.reply(`📋 *Sticker Triggers*\n━━━━━━━━━━━━━━━\n\n${lines}\n\n_Reply to a member's message with the set sticker to trigger the action._`);
      }

      if (sub === 'clear') {
        const toClear = args[1]?.toLowerCase();
        if (!toClear || !VALID_ACTIONS.includes(toClear)) {
          return extra.reply(`❌ Specify a valid action to clear:\n${VALID_ACTIONS.join(', ')}`);
        }
        if (!stickerActions[toClear]) {
          return extra.reply(`❌ No sticker trigger set for *${toClear}*.`);
        }
        delete stickerActions[toClear];
        database.updateGroupSettings(extra.from, { stickerActions });
        return extra.reply(`✅ Sticker trigger for *${toClear}* cleared.`);
      }

      if (!VALID_ACTIONS.includes(sub)) {
        return extra.reply(`❌ Invalid action. Valid actions:\n${VALID_ACTIONS.join(', ')}`);
      }

      const ctx = extractContextInfo(msg);
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
        `📌 ${ACTION_DESC[sub]}\n\n` +
        `_When an admin replies to a member's message with this sticker, *${sub}* will be applied to the quoted member._`
      );

    } catch (error) {
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};
