/**
 * SuperOwner Check — mini diagnostic command (test/diagnostic only)
 *
 * Replies whether the SENDER is this deployment's Super Owner.
 *
 * Deliberately NOT gated (no ownerOnly / superOwnerOnly): anyone may check
 * their own status. The persisted Super Owner number is NEVER displayed —
 * only a ✅ / ❌ / — indicator, so the command leaks nothing.
 *
 * This command cannot create, change or reset the Super Owner in any way.
 */

const { superOwnerStatusFor } = require('../../utils/ownership');

module.exports = {
  name: 'superowner',
  aliases: ['amso', 'superownercheck', 'so'],
  category: 'owner',
  description: 'Check whether you are this deployment\u2019s Super Owner (test command)',
  usage: '.superowner',

  async execute(sock, msg, args, extra) {
    const sender = extra.sender || msg.key.participant || msg.key.remoteJid || '';
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
