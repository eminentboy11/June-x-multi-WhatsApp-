/**
 * RepairBot Command - Re-arm a parked session (PLATFORM-LEVEL — Super Owner only)
 *
 * Usage: .repairbot <phone|id>
 *
 * For sessions parked as needs-login / pairing-exhausted / disconnected: the
 * session is rebooted with a FRESH pairing cycle (the configured phone
 * re-arms automatically — same budget rules as always). The new pairing code
 * and the connection status are delivered into THIS chat. Connected sessions
 * are left untouched.
 */

const { getCurrentBotId } = require('../../utils/botContext');

module.exports = {
  name: 'repairbot',
  aliases: ['fixbot', 'healbot', 'rearmbot'],
  category: 'owner',
  description: 'Restart a parked session with a fresh pairing cycle',
  usage: '.repairbot <phone|id>',
  superOwnerOnly: true,

  async execute(sock, msg, args, extra) {
    const identifier = String(args[0] || '').trim();
    if (!identifier) {
      return extra.reply(
        '⚠️ *Usage:* .repairbot <phone|id>\n\n' +
        'Example: .repairbot 2348165321909\n' +
        '_(check .bots for session ids)_'
      );
    }

    const hook = global.__JUNE_REPAIR_SESSION;
    if (typeof hook !== 'function') {
      return extra.reply('❌ Live session repair is not available in this build.');
    }

    const result = await hook(identifier, {
      chatJid: msg.key.remoteJid,
      viaBotId: getCurrentBotId(),
      quotedKey: msg.key,
    });
    if (!result.ok) {
      try { await extra.react('⚠️'); } catch (_) {}
      if (result.reason === 'unknown') {
        return extra.reply(`❌ No session matches *"${identifier}"*.\nRun *.bots* to see the registered sessions.`);
      }
      if (result.reason === 'online') {
        return extra.reply(`✅ Session *${result.id}* is already connected — nothing to repair.`);
      }
      return extra.reply(`❌ Repair failed: ${result.error || result.reason || 'unknown error'}`);
    }

    try { await extra.react('⏳'); } catch (_) {}
    return extra.reply(
      `🔧 *Repair started* for session *${result.id}*\n\n` +
      `🔄 Rebooting with a fresh pairing cycle.\n` +
      `🔑 The new pairing code will arrive *here* shortly — pair it from WhatsApp → Linked Devices.\n` +
      `✅ You'll get a connection status in this chat when it's done.`
    );
  },
};
