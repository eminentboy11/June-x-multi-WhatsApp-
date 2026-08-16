/**
 * Bots Command - Fleet status card for every registered session
 * (PLATFORM-LEVEL — Super Owner only)
 *
 * Read-only snapshot from the live session manager: state, masked account,
 * pairing info and connection time. No numbers beyond the registry phones
 * are exposed, and no ownership information is changed.
 */

const STATE_ICONS = {
  connected: '🟢',
  connecting: '🟡',
  'needs-login': '🔴',
  disconnected: '⚪',
};

function maskAccount(account) {
  return account ? ` (${account})` : '';
}

module.exports = {
  name: 'bots',
  aliases: ['sessions', 'listbots', 'botlist'],
  category: 'botmanager',
  description: 'Show every bot session on this deployment',
  usage: '.bots',
  superOwnerOnly: true,

  async execute(sock, msg, args, extra) {
    const snapshot = typeof global.__JUNE_SESSIONS_SNAPSHOT === 'function'
      ? global.__JUNE_SESSIONS_SNAPSHOT()
      : [];

    if (!Array.isArray(snapshot) || snapshot.length === 0) {
      return extra.reply('🤖 *No sessions registered.*');
    }

    const lines = ['🤖 *Bot Sessions*', `━━━━━━━━━━━━━━━`];
    for (const s of snapshot) {
      const icon = STATE_ICONS[s.state] || '⚪';
      const stateLabel = String(s.state || 'unknown').toUpperCase();
      lines.push(
        `${icon} *${String(s.name).replace(/\*/g, '')}* (${String(s.id).replace(/\*/g, '')})${maskAccount(s.account)}`,
        `   └ ${stateLabel}`
      );
      if (s.state === 'connecting' && s.pairingAttempts > 0) {
        lines.push(`   └ pairing codes used: ${s.pairingAttempts}`);
      }
      if (s.pairingExhausted) {
        lines.push('   └ ⚠️ pairing limit reached — .repairbot to retry');
      }
      if (s.connectedAt && s.state === 'connected') {
        lines.push(`   └ since ${new Date(s.connectedAt).toLocaleTimeString()}`);
      }
    }
    lines.push('━━━━━━━━━━━━━━━');

    return extra.reply(lines.join('\n'));
  },
};
