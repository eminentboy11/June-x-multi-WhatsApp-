const { sendButtons } = require('gifted-btns');
const config = require('../../config');

module.exports = {
    name: 'tutorial',
    aliases: ['deploy', 'host', 'tut'],
    category: 'tools',
    description: 'Get deployment tutorial links for various hosting platforms',
    usage: '.tutorial',

    async execute(sock, msg, args, extra) {
        try {
            const chatId = extra.from;

            const text =
                `┏━━『 *DEPLOYMENT TUTORIALS* 』━━\n\n` +
                `✬ Choose a platform below to get the\n` +
                `  full deployment tutorial for *${config.botName}*\n\n` +
                `┃ *Available Platforms*\n` +
                `☁️  Heroku\n` +
                `🖥️  Panels (Pterodactyl)\n` +
                `🚉  Railway\n` +
                `⚡  Optiklink\n` +
                `🔥  Daki.cc\n` +
                `🟣  Render\n\n` +
                `┗━━━━━━━━━━━━━━━━`;

            await sendButtons(sock, chatId, {
                title: '📚 BOT TUTORIALS',
                text,
                footer: `Powered by ${config.botName}`,
                buttons: [
                    {
                        name: 'cta_url',
                        buttonParamsJson: JSON.stringify({
                            display_text: '☁️ Deploy to Heroku',
                            url: 'https://heroku.com'
                        })
                    },
                    {
                        name: 'cta_url',
                        buttonParamsJson: JSON.stringify({
                            display_text: '🖥️ Deploy to Panels',
                            url: 'https://panel.daki.cc'
                        })
                    },
                    {
                        name: 'cta_url',
                        buttonParamsJson: JSON.stringify({
                            display_text: '🚉 Deploy to Railway',
                            url: 'https://railway.app'
                        })
                    },
                    {
                        name: 'cta_url',
                        buttonParamsJson: JSON.stringify({
                            display_text: '⚡ Deploy to Optiklink',
                            url: 'https://optiklink.com'
                        })
                    },
                    {
                        name: 'cta_url',
                        buttonParamsJson: JSON.stringify({
                            display_text: '🔥 Deploy to Daki.cc',
                            url: 'https://daki.cc'
                        })
                    },
                    {
                        name: 'cta_url',
                        buttonParamsJson: JSON.stringify({
                            display_text: '🟣 Deploy to Render',
                            url: 'https://render.com'
                        })
                    }
                ]
            }, { quoted: msg });

        } catch (error) {
            console.error('[tutorial] error:', error);
            await extra.reply(`❌ Error: ${error.message}`);
        }
    }
};
