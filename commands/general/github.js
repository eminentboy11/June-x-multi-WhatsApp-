const { sendButtons } = require('gifted-btns');
const axios  = require('axios');
const config = require(require('path').join(global.__ROOT__, 'config'));

const GITHUB_USER = 'Vinpink2';
const GITHUB_REPO = 'June_X_Ultra';
const REPO_URL    = `https://github.com/${GITHUB_USER}/${GITHUB_REPO}`;
const API_URL     = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}`;

module.exports = {
    name: 'github',
    aliases: ['repo', 'git', 'source', 'sc', 'script'],
    category: 'general',
    description: 'Show bot GitHub repository and statistics',
    usage: '.github',
    ownerOnly: false,

    async execute(sock, msg, args, extra) {
        try {
            const chatId = extra.from;
            const footer = `> Powered by ${config.botName}`;

            let text;
            let buttons;

            try {
                const { data: repo } = await axios.get(API_URL, {
                    headers: { 'User-Agent': 'June_X_Ultra' },
                    timeout: 10000
                });

                text =
                    `┏━━『 *GITHUB REPOSITORY* 』━━\n\n` +
                    `🔹 *Repository:* ${repo.name}\n` +
                    `🔹 *Owner:* ${repo.owner.login}\n` +
                    `🔹 *Description:* ${repo.description || 'N/A'}\n\n` +
                    `🔹 *Statistics*\n` +
                    `🔸 *Stars:* ${repo.stargazers_count.toLocaleString()}\n` +
                    `🔸 *Forks:* ${repo.forks_count.toLocaleString()}\n` +
                    `👀 *Watchers:* ${repo.watchers_count.toLocaleString()}\n` +
                    `🎲 *Size:* ${(repo.size / 1024).toFixed(2)} MB\n\n` +
                    `┗━━━━━━━━━━━━━━━━`;

                buttons = [
                    {
                        name: 'cta_url',
                        buttonParamsJson: JSON.stringify({
                            display_text: '🔗 View Repository',
                            url: repo.html_url
                        })
                    },
                    {
                        name: 'cta_url',
                        buttonParamsJson: JSON.stringify({
                            display_text: '⭐ Star Repo',
                            url: `${repo.html_url}/stargazers`
                        })
                    },
                    {
                        name: 'cta_url',
                        buttonParamsJson: JSON.stringify({
                            display_text: '🍴 Fork Repo',
                            url: `${repo.html_url}/fork`
                        })
                    },
                    {
                        name: 'cta_copy',
                        buttonParamsJson: JSON.stringify({
                            display_text: '📋 Copy Repo URL',
                            copy_code: repo.html_url
                        })
                    }
                ];

            } catch (apiError) {
                console.error('[GitHub] API error:', apiError.message);

                text =
                    `┏━━『 *GitHub Repository* 』━\n\n` +
                    `🤖 *Bot Name:* ${config.botName}\n` +
                    `🔗 *Repository:* ${GITHUB_REPO}\n` +
                    `👨‍💻 *Owner:* ${GITHUB_USER}\n` +
                    `🌐 *URL:* ${REPO_URL}\n\n` +
                    `⚠️ _Could not fetch live stats. Visit the repo for latest info._\n\n` +
                    `┗━━━━━━━━━━━━━━━━`;

                buttons = [
                    {
                        name: 'cta_url',
                        buttonParamsJson: JSON.stringify({
                            display_text: '🔗 View Repository',
                            url: REPO_URL
                        })
                    },
                    {
                        name: 'cta_url',
                        buttonParamsJson: JSON.stringify({
                            display_text: '⭐ Star Repo',
                            url: `${REPO_URL}/stargazers`
                        })
                    },
                    {
                        name: 'cta_url',
                        buttonParamsJson: JSON.stringify({
                            display_text: '🍴 Fork Repo',
                            url: `${REPO_URL}/fork`
                        })
                    },
                    {
                        name: 'cta_copy',
                        buttonParamsJson: JSON.stringify({
                            display_text: '📋 Copy Repo URL',
                            copy_code: REPO_URL
                        })
                    }
                ];
            }

            await sendButtons(sock, chatId, { text, footer, buttons }, { quoted: msg });

        } catch (error) {
            console.error('[GitHub] command error:', error);
            await extra.reply(`❌ Error: ${error.message}`);
        }
    }
};
