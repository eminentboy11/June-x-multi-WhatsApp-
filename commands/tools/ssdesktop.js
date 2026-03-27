/**
 * SSDesktop - Screenshot Website (Desktop/Tablet view)
 */

module.exports = {
    name: 'ssdesktop',
    aliases: ['sswebpc', 'sspc', 'sswin'],
    category: 'general',
    description: 'Take a desktop/tablet screenshot of a website',
    usage: '.ssdesktop <url>',

    async execute(sock, msg, args, extra) {
        const { from, reply, react } = extra;
        const url = args.join(' ').trim();

        if (!url) {
            return reply(
                `ðŸ’» *Desktop Screenshot*\n\n` +
                `Usage: \`.ssdesktop <url>\`\n` +
                `Example: \`.ssdesktop https://github.com\``
            );
        }

        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            return reply(`âŒ Please provide a valid URL starting with *http://* or *https://*`);
        }

        await react('ðŸ“¸');

        try {
            const apiURL = `https://api.siputzx.xyz/api/tools/ssweb?url=${encodeURIComponent(url)}&theme=light&device=tablet`;

            await sock.sendMessage(from, {
                image: { url: apiURL },
                caption: `ðŸ’» *Desktop Screenshot*\nðŸŒ ${url}`
            }, { quoted: msg });

        } catch (error) {
            console.error('SSDesktop error:', error);
            await reply(`âŒ Failed to take screenshot: ${error.message}`);
        }
    }
};
