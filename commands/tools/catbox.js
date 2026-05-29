/**
 * Catbox Command
 * Upload any file to catbox.moe via URL and get a permanent hosted link
 */

const axios = require('axios');
const { sendButtons } = require('gifted-btns');
const config = require('../../config');

module.exports = {
    name: 'catbox',
    aliases: ['cbox', 'host'],
    category: 'tools',
    description: 'Upload a file to catbox.moe via URL and get a permanent hosted link',
    usage: '.catbox <file-url>',

    async execute(sock, msg, args, extra) {
        try {
            const url = args.join(' ').trim();
            if (!url) return extra.reply(
                '❌ Please provide a file URL to upload!\nExample:\n.catbox https://example.com/image.png'
            );

            await sock.sendMessage(extra.from, { react: { text: '⏳', key: msg.key } });

            // Catbox URL upload API
            const formData = new URLSearchParams();
            formData.append('reqtype', 'urlupload');
            formData.append('url', url);

            const { data: hostedUrl } = await axios.post(
                'https://catbox.moe/user/api.php',
                formData.toString(),
                { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
            );

            if (!hostedUrl || !hostedUrl.startsWith('https://')) {
                throw new Error('Catbox returned an invalid response: ' + hostedUrl);
            }

            await sock.sendMessage(extra.from, { react: { text: '✅', key: msg.key } });

            // Extract filename from the returned URL
            const fileName = hostedUrl.split('/').pop();

            const responseText =
                ` *📦 File Hosted on Catbox*\n\n` +
                ` *Source:* ${url}\n` +
                ` *Hosted:* ${hostedUrl}\n` +
                ` *File:* ${fileName}`;

            await sendButtons(sock, extra.from, {
                text: responseText,
                footer: `> Powered by ${config.botName}`,
                buttons: [
                    {
                        name: 'cta_url',
                        buttonParamsJson: JSON.stringify({
                            display_text: '🌐 Open File',
                            url: hostedUrl
                        })
                    },
                    {
                        name: 'cta_copy',
                        buttonParamsJson: JSON.stringify({
                            display_text: '📋 Copy Link',
                            copy_code: hostedUrl
                        })
                    }
                ]
            }, { quoted: msg });

        } catch (error) {
            console.error('CATBOX ERROR:', error);
            await sock.sendMessage(extra.from, { react: { text: '❌', key: msg.key } });
            await extra.reply('❌ Failed to upload to Catbox: ' + (error.message || error));
        }
    }
};
