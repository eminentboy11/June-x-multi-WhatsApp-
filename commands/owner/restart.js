/**
 * ╔══════════════════════════════════════════╗
 * ║  FILE    : restart.js                    ║
 * ║  FEATURE : Restart bot for new updates   ║
 * ║  SCOPE   : Owner only                    ║
 * ╚══════════════════════════════════════════╝
 *
 * Gracefully closes the WhatsApp connection and exits.
 * Replit's workflow manager automatically restarts the process.
 * Saved session/credentials are preserved — no re-login needed.
 */

module.exports = {
    name: 'restart',
    aliases: ['reboot', 'reload'],
    category: 'owner',
    description: 'Restart the bot to apply updates (Owner Only)',
    usage: '.restart',
    ownerOnly: true,

    async execute(sock, msg, args, extra) {
        try {
            await extra.reply(
                '🔁 *Restarting bot...*\n\n' +
                '⏳ Please wait a few seconds.\n' +
                'The bot will reconnect automatically using saved credentials.'
            );

            setTimeout(async () => {
                try {
                    // Close WebSocket cleanly — does NOT log out, session stays intact
                    const activeSock = global.currentSock || sock;
                    if (activeSock?.ws) activeSock.ws.close();
                } catch (_) {}

                // Exit code 0 = intentional clean restart
                // Replit workflow manager restarts node index.js automatically
                process.exit(0);
            }, 1500);

        } catch (error) {
            console.error('[restart]', error.message);
            try {
                await extra.reply(`❌ Restart failed: ${error.message}`);
            } catch (_) {}
        }
    },
};
