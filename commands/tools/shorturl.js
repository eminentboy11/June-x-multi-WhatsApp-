/**
 * Short URL Command
 * Create a short URL from any link using TinyURL
 */

const axios = require('axios');
const { sendButtons } = require('gifted-btns');
const config = require('../../config');

module.exports = {
    name: 'shorturl',
    aliases: ['shortlink'],
    category: 'tools',
    description: 'Create a short URL from a long link',
    usage: '.shorturl <url>',

    async execute(sock, msg, args, extra) {
        try {
            const url = args.join(' ').trim();
            if (!url) return extra.reply('âŒ Please provide a link to shorten!\nExample:\n.shorturl https://google.com');

            await sock.sendMessage(extra.from, { react: { text: 'â³', key: msg.key } });

            const { data: shortUrl } = await axios.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`);

            await sock.sendMessage(extra.from, { react: { text: 'âœ…', key: msg.key } });

            const responseText =
                ` *Short URL Created*\n\n` +
                ` *Original:* ${url}\n` +
                ` *Shortened:* ${shortUrl}`;

            await sendButtons(sock, extra.from, {
                text: responseText,
                footer: `> Powered by ${config.botName}`,
                buttons: [
                    {
                        name: 'cta_url',
                        buttonParamsJson: JSON.stringify({
                            display_text: 'Open Link',
                            url: shortUrl
                        })
                    },
                    {
                        name: 'cta_copy',
                        buttonParamsJson: JSON.stringify({
                            display_text: '‹ Copy URL',
                            copy_code: shortUrl
                        })
                    }
                ]
            }, { quoted: msg });

        } catch (error) {
            console.error('SHORTLINK ERROR:', error);
            await sock.sendMessage(extra.from, { react: { text: 'âŒ', key: msg.key } });
            await extra.reply('âŒ Failed to create shortlink: ' + (error.message || error));
        }
    }
};
