const { sendButtons } = require('gifted-btns');
const axios  = require('axios');
const config = require('../../config');

const GITHUB_USER = 'Vinpink2';
const GITHUB_REPO = 'June_X_Ultra';
const REPO_URL    = `https://github.com/${GITHUB_USER}/${GITHUB_REPO}`;
const API_URL     = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}`;

// ── Button builder ────────────────────────────────────────────────────────────

function buildButtons(repoUrl) {
    return [
        // ── URL buttons ───────────────────────────────────────────────────────
        {
            name: 'cta_url',
            buttonParamsJson: JSON.stringify({
                display_text: '🔗 View Repository',
                url: repoUrl,
            })
        },
        {
            name: 'cta_url',
            buttonParamsJson: JSON.stringify({
                display_text: '📦 Get ZIP',
                url: `${repoUrl}/archive/refs/heads/main.zip`,
            })
        },
        {
            name: 'cta_url',
            buttonParamsJson: JSON.stringify({
                display_text: '⭐ Star Repo',
                url: `${repoUrl}/stargazers`,
            })
        },
        {
            name: 'cta_url',
            buttonParamsJson: JSON.stringify({
                display_text: '🍴 Fork Repo',
                url: `${repoUrl}/fork`,
            })
        },

        // ── Copy buttons ──────────────────────────────────────────────────────
        {
            name: 'cta_copy',
            buttonParamsJson: JSON.stringify({
                display_text: '🗂️ Get Repo (Clone URL)',
                copy_code: `https://github.com/${GITHUB_USER}/${GITHUB_REPO}.git`,
            })
        },
        {
            name: 'cta_copy',
            buttonParamsJson: JSON.stringify({
                display_text: '📋 Copy Repo URL',
                copy_code: repoUrl,
            })
        },
    ];
}

// ── Module ────────────────────────────────────────────────────────────────────

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
                // ── Live stats from GitHub API ────────────────────────────────
                const { data: repo } = await axios.get(API_URL, {
                    headers: { 'User-Agent': 'June_X_Ultra' },
                    timeout: 10000,
                });

                text =
                    `┏━━『 *GITHUB REPOSITORY* 』━━\n\n` +
                    `🔹 *Repository:**  ${repo.name}\n` +
                    `🔹 *Owner:*        ${repo.owner.login}\n` +
                    `🔹 *Description:*  ${repo.description || 'N/A'}\n` +
                    `🔹 *Language:*     ${repo.language || 'N/A'}\n` +
                    `🔹 *License:*      ${repo.license?.name || 'N/A'}\n\n` +
                    `📊 *Statistics*\n` +
                    `🔸 *Stars:*    ${repo.stargazers_count.toLocaleString()}\n` +
                    `🔸 *Forks:*    ${repo.forks_count.toLocaleString()}\n` +
                    `👀 *Watchers:* ${repo.watchers_count.toLocaleString()}\n` +
                    `🎲 *Size:*     ${(repo.size / 1024).toFixed(2)} MB\n` +
                    `🔓 *Visibility:* ${repo.private ? 'Private' : 'Public'}\n\n` +
                    `┗━━━━━━━━━━━━━━━━`;

                buttons = buildButtons(repo.html_url);

            } catch (apiError) {
                console.error('[GitHub] API error:', apiError.message);

                // ── Fallback — static info ────────────────────────────────────
                text =
                    `┏━━『 *GitHub Repository* 』━\n\n` +
                    `🤖 *Bot Name:*    ${config.botName}\n` +
                    `🔗 *Repository:*  ${GITHUB_REPO}\n` +
                    `👨‍💻 *Owner:*       ${GITHUB_USER}\n` +
                    `🌐 *URL:*         ${REPO_URL}\n\n` +
                    `⚠️ _Could not fetch live stats. Visit the repo for latest info._\n\n` +
                    `┗━━━━━━━━━━━━━━━━`;

                buttons = buildButtons(REPO_URL);
            }

            await sendButtons(sock, chatId, { text, footer, buttons }, { quoted: msg });

        } catch (error) {
            console.error('[GitHub] command error:', error);
            await extra.reply(`❌ Error: ${error.message}`);
        }
    }
};
