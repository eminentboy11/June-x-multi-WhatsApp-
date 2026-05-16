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
    const senderNum = sender.split('@')[0];

    const participants = groupMetadata?.participants || [];
    const senderEntry = participants.find(p => p.id === sender || p.lid === sender);
    const senderIsAdmin = senderEntry?.admin === 'admin' || senderEntry?.admin === 'superadmin';

    const botJid = sock.user?.id
      ? sock.user.id.split(':')[0] + '@s.whatsapp.net'
      : null;
    const senderIsBot = botJid && (sender === botJid || sender === sock.user?.id);
    if (senderIsBot) return;

    switch (action) {
      case 'kick': {
        if (senderIsAdmin) {
          await sock.sendMessage(from, {
            text: `⚠️ @${senderNum} is an admin, cannot kick.`,
            mentions: [sender]
          });
          return;
        }
        await sock.groupParticipantsUpdate(from, [sender], 'remove');
        await sock.sendMessage(from, {
          text: `👢 @${senderNum} was kicked via sticker trigger.`,
          mentions: [sender]
        });
        break;
      }

      case 'demote': {
        if (!senderIsAdmin) {
          await sock.sendMessage(from, {
            text: `⚠️ @${senderNum} is not an admin.`,
            mentions: [sender]
          });
          return;
        }
        await sock.groupParticipantsUpdate(from, [sender], 'demote');
        await sock.sendMessage(from, {
          text: `⬇️ @${senderNum} has been demoted via sticker trigger.`,
          mentions: [sender]
        });
        break;
      }

      case 'promote': {
        if (senderIsAdmin) {
          await sock.sendMessage(from, {
            text: `⚠️ @${senderNum} is already an admin.`,
            mentions: [sender]
          });
          return;
        }
        await sock.groupParticipantsUpdate(from, [sender], 'promote');
        await sock.sendMessage(from, {
          text: `⬆️ @${senderNum} has been promoted via sticker trigger.`,
          mentions: [sender]
        });
        break;
      }

      case 'warn': {
        const maxWarns = config.maxWarnings || 3;
        const warnData = database.addWarning(from, sender, 'Sent trigger sticker');
        if (warnData.count >= maxWarns) {
          await sock.sendMessage(from, {
            text: `⚠️ @${senderNum} has been warned (${warnData.count}/${maxWarns}) via sticker trigger and will be removed!`,
            mentions: [sender]
          });
          await sock.groupParticipantsUpdate(from, [sender], 'remove');
          database.clearWarnings(from, sender);
        } else {
          await sock.sendMessage(from, {
            text: `⚠️ @${senderNum} warned (${warnData.count}/${maxWarns}) via sticker trigger.`,
            mentions: [sender]
          });
        }
        break;
      }

      case 'mute': {
        database.muteUser(from, sender);
        await sock.sendMessage(from, {
          text: `🔇 @${senderNum} has been muted via sticker trigger.`,
          mentions: [sender]
        });
        break;
      }

      case 'add': {
        try {
          await sock.groupParticipantsUpdate(from, [sender], 'add');
        } catch (_) {}
        await sock.sendMessage(from, {
          text: `➕ @${senderNum} re-added via sticker trigger.`,
          mentions: [sender]
        });
        break;
      }

      case 'tagall': {
        const allMembers = participants.map(p => p.id);
        const mentions = allMembers.map(id => `@${id.split('@')[0]}`).join(' ');
        await sock.sendMessage(from, {
          text: `📢 @${senderNum} triggered tagall!\n\n${mentions}`,
          mentions: allMembers
        });
        break;
      }
    }
  } catch (err) {
    console.error('[StickerTrigger] Error:', err.message);
  }
};

module.exports = { handleStickerTrigger };
