const { sendButtons } = require('gifted-btns');
const axios  = require('axios');
const config = require('../../config');

const GITHUB_USER = 'Vinpink2';
const GITHUB_REPO = 'June_X_Ultra';
const REPO_URL    = `https://github.com/${GITHUB_USER}/${GITHUB_REPO}`;
const API_URL     = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractButtonResponseId(msg) {
    return (
        msg.message?.buttonsResponseMessage?.selectedButtonId ||
        msg.message?.templateButtonReplyMessage?.selectedId ||
        msg.message?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson ||
        null
    );
}

function getResponseSender(msg) {
    return msg.key?.participant || msg.key?.remoteJid;
}

// ── Button builders ───────────────────────────────────────────────────────────

// Main buttons — mix of cta (URL/copy) + one interceptable id button for ZIP
function buildMainButtons(repoUrl, dateNow) {
    const prefix = config.prefix || '.';
    return [
        // Interceptable — bot catches this tap and shows branch selection
        { id: `${prefix}ghzip_${dateNow}`, text: '📦 Get ZIP' },

        // URL buttons — open browser directly
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

        // Copy buttons
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

// Branch selection buttons shown after tapping "Get ZIP"
function buildBranchButtons(branches, dateNow) {
    const prefix = config.prefix || '.';
    return branches.map((branch, i) => ({
        id:   `${prefix}ghbranch_${i}_${dateNow}`,
        text: `🌿 ${branch}`,
    }));
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
            const chatId         = extra.from;
            const prefix         = config.prefix || '.';
            const originalSender = msg.key?.participant || msg.key?.remoteJid;
            const footer         = `> Powered by ${config.botName}`;
            const dateNow        = Date.now();

            let text;
            let repoUrl  = REPO_URL;
            let branches = ['main', 'master', 'dev']; // default fallback

            try {
                // ── Live stats from GitHub API ────────────────────────────────
                const [{ data: repo }, { data: branchData }] = await Promise.all([
                    axios.get(API_URL, {
                        headers: { 'User-Agent': 'June_X_Ultra' },
                        timeout: 10000,
                    }),
                    axios.get(`${API_URL}/branches`, {
                        headers: { 'User-Agent': 'June_X_Ultra' },
                        timeout: 10000,
                    }),
                ]);

                repoUrl  = repo.html_url;

                // Use real branches from API, max 5
                if (Array.isArray(branchData) && branchData.length) {
                    branches = branchData.slice(0, 5).map(b => b.name);
                }

                text =
                    `┏━━『 *GITHUB REPOSITORY* 』━━\n\n` +
                    `🔹 *Repository:*   ${repo.name}\n` +
                    `🔹 *Owner:*        ${repo.owner.login}\n` +
                    `🔹 *Description:*  ${repo.description || 'N/A'}\n` +
                    `🔹 *Language:*     ${repo.language || 'N/A'}\n` +
                    `🔹 *License:*      ${repo.license?.name || 'N/A'}\n\n` +
                    `📊 *Statistics*\n` +
                    `🔸 *Stars:*      ${repo.stargazers_count.toLocaleString()}\n` +
                    `🔸 *Forks:*      ${repo.forks_count.toLocaleString()}\n` +
                    `👀 *Watchers:*   ${repo.watchers_count.toLocaleString()}\n` +
                    `🎲 *Size:*       ${(repo.size / 1024).toFixed(2)} MB\n` +
                    `🔓 *Visibility:* ${repo.private ? 'Private' : 'Public'}\n\n` +
                    `┗━━━━━━━━━━━━━━━━`;

            } catch (apiError) {
                console.error('[GitHub] API error:', apiError.message);

                text =
                    `┏━━『 *GitHub Repository* 』━\n\n` +
                    `🤖 *Bot Name:*    ${config.botName}\n` +
                    `🔗 *Repository:*  ${GITHUB_REPO}\n` +
                    `👨‍💻 *Owner:*       ${GITHUB_USER}\n` +
                    `🌐 *URL:*         ${REPO_URL}\n\n` +
                    `⚠️ _Could not fetch live stats. Visit the repo for latest info._\n\n` +
                    `┗━━━━━━━━━━━━━━━━`;
            }

            // ── Send main buttons ─────────────────────────────────────────────
            await sendButtons(sock, chatId, {
                text,
                footer,
                buttons: buildMainButtons(repoUrl, dateNow),
            }, { quoted: msg });

            // ── Listen for "Get ZIP" tap ──────────────────────────────────────
            const handleZipTap = async (event) => {
                const messageData = event.messages[0];
                if (!messageData?.message) return;

                const selectedId = extractButtonResponseId(messageData);
                if (!selectedId) return;

                // Only this session's ZIP button
                if (selectedId !== `${prefix}ghzip_${dateNow}`) return;

                // Only this chat
                if (messageData.key?.remoteJid !== chatId) return;

                // Only original sender — silent ignore for everyone else
                const responseSender = getResponseSender(messageData);
                if (responseSender !== originalSender) return;

                // ── Show branch selection buttons ─────────────────────────────
                const branchDateNow = Date.now();

                const branchList = branches
                    .map((b, i) => `*${i + 1}.* \`${b}\``)
                    .join('\n');

                await sendButtons(sock, chatId, {
                    title:   '📦 SELECT BRANCH',
                    text:
                        `Select a branch to download as ZIP:\n\n` +
                        `${branchList}`,
                    footer:  `Made by ${config.botName}`,
                    buttons: buildBranchButtons(branches, branchDateNow),
                }, { quoted: messageData });

                // ── Listen for branch selection ───────────────────────────────
                const handleBranchSelect = async (branchEvent) => {
                    const branchMsg = branchEvent.messages[0];
                    if (!branchMsg?.message) return;

                    const branchId = extractButtonResponseId(branchMsg);
                    if (!branchId) return;

                    // Only this branch session
                    if (!branchId.includes(`ghbranch_`) || !branchId.includes(`_${branchDateNow}`)) return;

                    // Only this chat
                    if (branchMsg.key?.remoteJid !== chatId) return;

                    // Only original sender — silent ignore for everyone else
                    const branchSender = getResponseSender(branchMsg);
                    if (branchSender !== originalSender) return;

                    // Extract branch index
                    const match = branchId.replace(prefix, '').match(/^ghbranch_(\d+)_/);
                    if (!match) return;

                    const branchIndex    = parseInt(match[1]);
                    const selectedBranch = branches[branchIndex];
                    if (!selectedBranch) return;

                    const zipUrl = `${repoUrl}/archive/refs/heads/${selectedBranch}.zip`;

                    // Send ZIP download link + copy button
                    await sendButtons(sock, chatId, {
                        title:   `📦 ${GITHUB_REPO} — ${selectedBranch}.zip`,
                        text:
                            `⿻ *Branch:*     \`${selectedBranch}\`\n` +
                            `⿻ *Repository:* ${GITHUB_REPO}\n` +
                            `⿻ *Owner:*      ${GITHUB_USER}\n\n` +
                            `Tap *Open ZIP* to download, or *Copy Link* to share.`,
                        footer:  `Made by ${config.botName}`,
                        buttons: [
                            {
                                name: 'cta_url',
                                buttonParamsJson: JSON.stringify({
                                    display_text: '📥 Open ZIP',
                                    url: zipUrl,
                                })
                            },
                            {
                                name: 'cta_copy',
                                buttonParamsJson: JSON.stringify({
                                    display_text: '📋 Copy ZIP Link',
                                    copy_code: zipUrl,
                                })
                            },
                        ],
                    }, { quoted: branchMsg });

                    await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });
                };

                sock.ev.on('messages.upsert', handleBranchSelect);
            };

            sock.ev.on('messages.upsert', handleZipTap);

        } catch (error) {
            console.error('[GitHub] command error:', error);
            await extra.reply(`❌ Error: ${error.message}`);
        }
    }
};
