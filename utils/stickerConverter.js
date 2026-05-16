const database = require('../database');
const config = require('../config');

const getStickerHash = (stickerMsg) => {
  const raw = stickerMsg?.fileSha256;
  if (!raw) return null;
  if (Buffer.isBuffer(raw)) return raw.toString('base64');
  if (typeof raw === 'object') return Buffer.from(Object.values(raw)).toString('base64');
  return null;
};

const handleStickerTrigger = async (sock, msg, groupMetadata) => {
  try {
    const from = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;

    if (!from || !sender || msg.key.fromMe) return;

    const stickerMsg = msg.message?.stickerMessage;
    if (!stickerMsg) return;

    const groupSettings = database.getGroupSettings(from);
    const stickerActions = groupSettings.stickerActions;
    if (!stickerActions || !Object.keys(stickerActions).length) return;

    const incomingHash = getStickerHash(stickerMsg);
    if (!incomingHash) return;

    const matchedAction = Object.entries(stickerActions).find(([, hash]) => hash === incomingHash);
    if (!matchedAction) return;

    const action = matchedAction[0];

    // Target is the person whose message was replied to
    const ctx = stickerMsg?.contextInfo;
    const target = ctx?.participant;

    const participants = groupMetadata?.participants || [];

    // tagall doesn't need a target
    if (action === 'tagall') {
      const allMembers = participants.map(p => p.id);
      const senderNum = sender.split('@')[0];
      const mentions = allMembers.map(id => `@${id.split('@')[0]}`).join(' ');
      await sock.sendMessage(from, {
        text: `📢 @${senderNum} triggered tagall!\n\n${mentions}`,
        mentions: allMembers
      });
      return;
    }

    if (!target) {
      await sock.sendMessage(from, {
        text: `⚠️ Reply to a user's message with this sticker to apply the *${action}* action.`,
        mentions: []
      }, { quoted: msg });
      return;
    }

    const botJid = sock.user?.id
      ? sock.user.id.split(':')[0] + '@s.whatsapp.net'
      : null;
    if (botJid && (target === botJid || target === sock.user?.id)) return;

    const targetNum = target.split('@')[0];
    const targetEntry = participants.find(p => p.id === target || p.lid === target);
    const targetIsAdmin = targetEntry?.admin === 'admin' || targetEntry?.admin === 'superadmin';

    switch (action) {
      case 'kick': {
        if (targetIsAdmin) {
          await sock.sendMessage(from, {
            text: `⚠️ @${targetNum} is an admin, cannot kick.`,
            mentions: [target]
          });
          return;
        }
        await sock.groupParticipantsUpdate(from, [target], 'remove');
        await sock.sendMessage(from, {
          text: `👢 @${targetNum} was kicked via sticker trigger.`,
          mentions: [target]
        });
        break;
      }

      case 'demote': {
        if (!targetIsAdmin) {
          await sock.sendMessage(from, {
            text: `⚠️ @${targetNum} is not an admin.`,
            mentions: [target]
          });
          return;
        }
        await sock.groupParticipantsUpdate(from, [target], 'demote');
        await sock.sendMessage(from, {
          text: `⬇️ @${targetNum} has been demoted via sticker trigger.`,
          mentions: [target]
        });
        break;
      }

      case 'promote': {
        if (targetIsAdmin) {
          await sock.sendMessage(from, {
            text: `⚠️ @${targetNum} is already an admin.`,
            mentions: [target]
          });
          return;
        }
        await sock.groupParticipantsUpdate(from, [target], 'promote');
        await sock.sendMessage(from, {
          text: `⬆️ @${targetNum} has been promoted via sticker trigger.`,
          mentions: [target]
        });
        break;
      }

      case 'warn': {
        const maxWarns = config.maxWarnings || 3;
        const warnData = database.addWarning(from, target, 'Sticker trigger warning');
        if (warnData.count >= maxWarns) {
          await sock.sendMessage(from, {
            text: `⚠️ @${targetNum} has been warned (${warnData.count}/${maxWarns}) via sticker trigger and will be removed!`,
            mentions: [target]
          });
          await sock.groupParticipantsUpdate(from, [target], 'remove');
          database.clearWarnings(from, target);
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
        await sock.sendMessage(from, {
          text: `🔇 @${targetNum} has been muted via sticker trigger.`,
          mentions: [target]
        });
        break;
      }

      case 'add': {
        try {
          await sock.groupParticipantsUpdate(from, [target], 'add');
        } catch (_) {}
        await sock.sendMessage(from, {
          text: `➕ @${targetNum} re-added via sticker trigger.`,
          mentions: [target]
        });
        break;
      }
    }
  } catch (err) {
    console.error('[StickerTrigger] Error:', err.message);
  }
};

module.exports = { handleStickerTrigger };
