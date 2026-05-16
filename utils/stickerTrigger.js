const database = require('../database');
const config = require('../config');
const { findParticipant } = require('./jidHelper');

const SKIP_KEYS = ['messageContextInfo', 'protocolMessage', 'senderKeyDistributionMessage'];

const WRAPPERS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
];

function toBase64Hash(raw) {
  if (!raw) return null;
  if (Buffer.isBuffer(raw)) return raw.toString('base64');
  if (typeof raw === 'object') return Buffer.from(Object.values(raw)).toString('base64');
  return null;
}

function resolveContent(message) {
  if (!message) return null;
  const keys = Object.keys(message).filter(k => !SKIP_KEYS.includes(k));
  const top = keys[0];
  if (!top) return null;
  if (WRAPPERS.includes(top)) return message[top]?.message || null;
  return message;
}

// Returns true if the incoming sticker matches a stored trigger entry.
// stored can be a plain base64 string (legacy) or { fileSha256, fileEncSha256 }.
function hashMatches(stored, stickerMsg) {
  const f1 = toBase64Hash(stickerMsg?.fileSha256);
  const f2 = toBase64Hash(stickerMsg?.fileEncSha256);
  if (typeof stored === 'string') {
    return stored === f1 || stored === f2;
  }
  if (stored && typeof stored === 'object') {
    if (stored.fileSha256    && f1 && stored.fileSha256    === f1) return true;
    if (stored.fileEncSha256 && f2 && stored.fileEncSha256 === f2) return true;
  }
  return false;
}

const handleStickerTrigger = async (sock, msg, groupMetadata) => {
  try {
    const from = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;

    if (!from || !sender || msg.key.fromMe) return;

    // Unwrap through Baileys message wrappers
    const content = resolveContent(msg.message);
    if (!content) return;

    const stickerMsg = content.stickerMessage;
    if (!stickerMsg) return;

    const groupSettings = database.getGroupSettings(from);
    const stickerActions = groupSettings.stickerActions;
    if (!stickerActions || !Object.keys(stickerActions).length) return;

    const matchedAction = Object.entries(stickerActions).find(([, stored]) => hashMatches(stored, stickerMsg));
    if (!matchedAction) return;

    const action = matchedAction[0];

    // Fetch fresh metadata for accurate admin checks and JID resolution
    let freshMeta;
    try {
      freshMeta = await sock.groupMetadata(from);
    } catch (_) {
      freshMeta = groupMetadata;
    }
    const participants = freshMeta?.participants || [];

    // Only admins can trigger sticker actions
    const senderEntry = findParticipant(participants, sender);
    const senderIsAdmin = senderEntry?.admin === 'admin' || senderEntry?.admin === 'superadmin';
    if (!senderIsAdmin) return;

    // Check bot has admin rights (needed for most actions)
    const botId = sock.user?.id;
    const botLid = sock.user?.lid;
    const botEntry = findParticipant(participants, [botId, botLid].filter(Boolean));
    const botIsAdmin = botEntry?.admin === 'admin' || botEntry?.admin === 'superadmin';

    // tagall doesn't need a target or bot admin
    if (action === 'tagall') {
      const allMembers = participants.map(p => p.id);
      const senderNum = sender.split('@')[0].split(':')[0];
      const mentions = allMembers.map(id => `@${id.split('@')[0]}`).join(' ');
      await sock.sendMessage(from, {
        text: `📢 @${senderNum} triggered tagall!\n\n${mentions}`,
        mentions: allMembers
      });
      return;
    }

    // Resolve target from contextInfo (the person being replied to)
    const ctx = stickerMsg.contextInfo;
    const rawTarget = ctx?.participant;

    if (!rawTarget) {
      await sock.sendMessage(from, {
        text: `⚠️ Reply to a user's message with this sticker to apply the *${action}* action.`,
      }, { quoted: msg });
      return;
    }

    // Resolve target to proper JID via LID-aware lookup
    const targetEntry = findParticipant(participants, rawTarget);
    if (!targetEntry) {
      await sock.sendMessage(from, {
        text: `⚠️ Could not find that member in the group.`,
      }, { quoted: msg });
      return;
    }

    const target = targetEntry.id;
    const targetNum = target.split('@')[0].split(':')[0];
    const targetIsAdmin = targetEntry.admin === 'admin' || targetEntry.admin === 'superadmin';

    // Prevent acting on the bot itself
    if (botId && (target === botId || target.split(':')[0] === botId.split(':')[0])) return;

    if (!botIsAdmin && !['warn', 'mute'].includes(action)) {
      await sock.sendMessage(from, { text: `⚠️ Bot needs admin rights to perform *${action}*.` }, { quoted: msg });
      return;
    }

    switch (action) {
      case 'kick': {
        if (targetIsAdmin) {
          await sock.sendMessage(from, { text: `⚠️ @${targetNum} is an admin, cannot kick.`, mentions: [target] });
          return;
        }
        await sock.groupParticipantsUpdate(from, [target], 'remove');
        await sock.sendMessage(from, { text: `👢 @${targetNum} was kicked via sticker trigger.`, mentions: [target] });
        break;
      }

      case 'demote': {
        if (!targetIsAdmin) {
          await sock.sendMessage(from, { text: `⚠️ @${targetNum} is not an admin.`, mentions: [target] });
          return;
        }
        await sock.groupParticipantsUpdate(from, [target], 'demote');
        await sock.sendMessage(from, { text: `⬇️ @${targetNum} has been demoted via sticker trigger.`, mentions: [target] });
        break;
      }

      case 'promote': {
        if (targetIsAdmin) {
          await sock.sendMessage(from, { text: `⚠️ @${targetNum} is already an admin.`, mentions: [target] });
          return;
        }
        await sock.groupParticipantsUpdate(from, [target], 'promote');
        await sock.sendMessage(from, { text: `⬆️ @${targetNum} has been promoted via sticker trigger.`, mentions: [target] });
        break;
      }

      case 'warn': {
        const maxWarns = config.maxWarnings || 3;
        const warnData = database.addWarning(from, target, 'Sticker trigger warning');
        if (warnData.count >= maxWarns) {
          await sock.sendMessage(from, {
            text: `⚠️ @${targetNum} warned (${warnData.count}/${maxWarns}) via sticker and will be removed!`,
            mentions: [target]
          });
          if (botIsAdmin && !targetIsAdmin) {
            await sock.groupParticipantsUpdate(from, [target], 'remove');
            database.clearWarnings(from, target);
          }
        } else {
          await sock.sendMessage(from, {
            text: `⚠️ @${targetNum} warned (${warnData.count}/${maxWarns}) via sticker trigger.`,
            mentions: [target]
          });
        }
        break;
      }

      case 'mute': {
        database.muteUser(from, target);
        await sock.sendMessage(from, { text: `🔇 @${targetNum} has been muted via sticker trigger.`, mentions: [target] });
        break;
      }

      case 'add': {
        try { await sock.groupParticipantsUpdate(from, [target], 'add'); } catch (_) {}
        await sock.sendMessage(from, { text: `➕ @${targetNum} re-added via sticker trigger.`, mentions: [target] });
        break;
      }
    }
  } catch (err) {
    console.error('[StickerTrigger] Error:', err.message);
  }
};

module.exports = { handleStickerTrigger };
