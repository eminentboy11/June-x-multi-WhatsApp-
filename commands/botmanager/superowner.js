/**
 * SuperOwner Check — mini diagnostic command (test/diagnostic only)
 *
 * Replies whether the SENDER is this deployment's Super Owner.
 *
 * Restricted to the persisted Super Owner and answered only by the Super
 * Owner's connected bot session, matching every command in botmanager/.
 * The persisted number is never revealed as a separate value.
 *
 * This command cannot create, change or reset the Super Owner in any way.
 */

const { superOwnerStatusFor } = require('../../utils/core/ownership');

module.exports = {
  name: 'superowner',
  aliases: ['amso', 'superownercheck', 'so'],
  category: 'botmanager',
  description: 'Confirm the deployment Super Owner control session',
  usage: '.superowner',
  superOwnerOnly: true,
  superOwnerSessionOnly: true,

  async execute(sock, msg, args, extra) {
    // The handler resolves participantAlt/LID before authorization and exposes
    // the canonical phone JID here. Never display an opaque LID as a number.
    const sender = extra.resolvedSender || extra.sender || msg.key.participantAlt ||
      msg.key.participant || msg.key.remoteJidAlt || msg.key.remoteJid || '';
    const yourNumber = String(sender).split(':')[0].split('@')[0];
    const status = superOwnerStatusFor(yourNumber);

    const lines = [
      '👑 *Super Owner Check*',
      '',
      `📱 You: ${yourNumber}`,
      `🛡️ Super Owner: ${status}`,
      '',
    ];

    if (status === '✅') {
      lines.push('You ARE this deployment\u2019s Super Owner.');
    } else if (status === '❌') {
      lines.push('You are NOT the Super Owner.');
    } else {
      lines.push('No Super Owner has been established on this deployment yet.');
    }

    lines.push('', '_(The Super Owner number is never displayed.)_');

    return extra.reply(lines.join('\n'));
  },
};
