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

// Keys that must be skipped when looking for the real message type
const SKIP_KEYS = ['messageContextInfo', 'protocolMessage', 'senderKeyDistributionMessage'];

const WRAPPERS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
];

function resolveContent(message) {
  if (!message) return null;
  const keys = Object.keys(message).filter(k => !SKIP_KEYS.includes(k));
  const top = keys[0];
  if (!top) return null;
  if (WRAPPERS.includes(top)) return message[top]?.message || null;
  return message;
}

function extractContextInfo(msg) {
  const content = resolveContent(msg.message);
  if (!content) return null;
  // Find the real message type, skipping protocol/meta keys
  const keys = Object.keys(content).filter(k => !SKIP_KEYS.includes(k));
  const top = keys[0];
  if (!top) return null;
  return content[top]?.contextInfo || null;
}

function toBase64Hash(raw) {
  if (!raw) return null;
  if (Buffer.isBuffer(raw)) return raw.toString('base64');
  if (typeof raw === 'object') return Buffer.from(Object.values(raw)).toString('base64');
  return null;
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
          `When an admin replies to a member's message with that sticker, the action is applied to the *quoted member*.\n\n` +
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
        return extra.reply(
          `📋 *Sticker Triggers*\n━━━━━━━━━━━━━━━\n\n${lines}\n\n` +
          `_Reply to a member's message with the set sticker to trigger the action._`
        );
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

      // Use fileSha256 as primary, fileEncSha256 as fallback
      const hash = toBase64Hash(quotedSticker.fileSha256) || toBase64Hash(quotedSticker.fileEncSha256);
      if (!hash) return extra.reply('❌ Could not read sticker fingerprint. Try a different sticker.');

      // Store both hashes so the trigger can match on either
      stickerActions[sub] = {
        fileSha256:    toBase64Hash(quotedSticker.fileSha256)    || null,
        fileEncSha256: toBase64Hash(quotedSticker.fileEncSha256) || null,
      };
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
