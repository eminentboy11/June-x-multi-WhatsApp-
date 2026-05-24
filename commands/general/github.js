const { sendButtons } = require('gifted-btns');
const axios  = require('axios');
const config = require('../../config');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');

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

function buildMainButtons(repoUrl, dateNow) {
    const prefix = config.prefix || '.';
    return [
        // 1 — URL
        {
            name: 'cta_url',
            buttonParamsJson: JSON.stringify({
                display_text: '🔗 View Repository',
                url: repoUrl,
            })
        },
        // 2 — URL
        {
            name: 'cta_url',
            buttonParamsJson: JSON.stringify({
                display_text: '⭐ Star Repo',
                url: `${repoUrl}/stargazers`,
            })
        },
        // 3 — URL
        {
            name: 'cta_url',
            buttonParamsJson: JSON.stringify({
                display_text: '🍴 Fork Repo',
                url: `${repoUrl}/fork`,
            })
        },
        // 4 — Copy
        {
            name: 'cta_copy',
            buttonParamsJson: JSON.stringify({
                display_text: '🗂️ Get Repo (Clone URL)',
                copy_code: `https://github.com/${GITHUB_USER}/${GITHUB_REPO}.git`,
            })
        },
        // 5 — Copy
        {
            name: 'cta_copy',
            buttonParamsJson: JSON.stringify({
                display_text: '📋 Copy Repo URL',
                copy_code: repoUrl,
            })
        },
        // 6 — Interceptable (bot catches tap → branch selection → download ZIP)
        { id: `${prefix}ghzip_${dateNow}`, text: '📦 Get ZIP' },
    ];
}

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
            let branches = ['main', 'master', 'dev'];

            try {
                // ── Live stats + branches from GitHub API ─────────────────────
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

                repoUrl = repo.html_url;

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

            // ── Step 1: Send main buttons ─────────────────────────────────────
            await sendButtons(sock, chatId, {
                text,
                footer,
                buttons: buildMainButtons(repoUrl, dateNow),
            }, { quoted: msg });

            // ── Step 2: Listen for "Get ZIP" tap ──────────────────────────────
            const handleZipTap = async (event) => {
                const messageData = event.messages[0];
                if (!messageData?.message) return;

                const selectedId = extractButtonResponseId(messageData);
                if (!selectedId) return;
                if (selectedId !== `${prefix}ghzip_${dateNow}`) return;
                if (messageData.key?.remoteJid !== chatId) return;

                // Only original sender — silent ignore for everyone else
                const responseSender = getResponseSender(messageData);
                if (responseSender !== originalSender) return;

                // ── Step 3: Show branch selection buttons ─────────────────────
                const branchDateNow = Date.now();

                await sendButtons(sock, chatId, {
                    title:   '📦 SELECT BRANCH',
                    text:
                        `Select a branch to download as ZIP:\n\n` +
                        branches.map((b, i) => `*${i + 1}.* \`${b}\``).join('\n'),
                    footer:  `Made by ${config.botName}`,
                    buttons: buildBranchButtons(branches, branchDateNow),
                }, { quoted: messageData });

                // ── Step 4: Listen for branch selection ───────────────────────
                const handleBranchSelect = async (branchEvent) => {
                    const branchMsg = branchEvent.messages[0];
                    if (!branchMsg?.message) return;

                    const branchId = extractButtonResponseId(branchMsg);
                    if (!branchId) return;
                    if (!branchId.includes('ghbranch_') || !branchId.includes(`_${branchDateNow}`)) return;
                    if (branchMsg.key?.remoteJid !== chatId) return;

                    // Only original sender — silent ignore for everyone else
                    const branchSender = getResponseSender(branchMsg);
                    if (branchSender !== originalSender) return;

                    const match = branchId.replace(prefix, '').match(/^ghbranch_(\d+)_/);
                    if (!match) return;

                    const selectedBranch = branches[parseInt(match[1])];
                    if (!selectedBranch) return;

                    const zipUrl     = `${repoUrl}/archive/refs/heads/${selectedBranch}.zip`;
                    const zipDateNow = Date.now();

                    // ── Step 5: Show ZIP options ──────────────────────────────
                    await sendButtons(sock, chatId, {
                        title:   `📦 ${GITHUB_REPO} — ${selectedBranch}`,
                        text:
                            `⿻ *Branch:*     \`${selectedBranch}\`\n` +
                            `⿻ *Repository:* ${GITHUB_REPO}\n` +
                            `⿻ *Owner:*      ${GITHUB_USER}\n\n` +
                            `Tap *Download & Send ZIP* and the bot will fetch and send the file here.`,
                        footer:  `Made by ${config.botName}`,
                        buttons: [
                            // 1 — Copy link
                            {
                                name: 'cta_copy',
                                buttonParamsJson: JSON.stringify({
                                    display_text: '📋 Copy ZIP Link',
                                    copy_code: zipUrl,
                                })
                            },
                            // 2 — Interceptable: bot downloads & sends ZIP
                            {
                                id:   `${prefix}ghopzip_${zipDateNow}`,
                                text: '📥 Download & Send ZIP',
                            },
                        ],
                    }, { quoted: branchMsg });

                    // ── Step 6: Listen for "Download & Send ZIP" tap ──────────
                    const handleOpenZip = async (zipEvent) => {
                        const zipMsg = zipEvent.messages[0];
                        if (!zipMsg?.message) return;

                        const zipId = extractButtonResponseId(zipMsg);
                        if (!zipId) return;
                        if (zipId !== `${prefix}ghopzip_${zipDateNow}`) return;
                        if (zipMsg.key?.remoteJid !== chatId) return;

                        // Only original sender — silent ignore for everyone else
                        const zipSender = getResponseSender(zipMsg);
                        if (zipSender !== originalSender) return;

                        await sock.sendMessage(chatId, { react: { text: '⏳', key: msg.key } });

                        let filePath;
                        try {
                            // ✅ os.tmpdir() — always exists on any host
                            filePath = path.join(
                                os.tmpdir(),
                                `${GITHUB_REPO}-${selectedBranch}-${zipDateNow}.zip`
                            );

                            const zipStream = await axios({
                                method:       'get',
                                url:          zipUrl,
                                responseType: 'stream',
                                timeout:      120000,
                                headers:      { 'User-Agent': 'June_X_Ultra' },
                                maxRedirects: 5,
                            });

                            const writer = fs.createWriteStream(filePath);
                            zipStream.data.pipe(writer);
                            await new Promise((resolve, reject) => {
                                writer.on('finish', resolve);
                                writer.on('error', reject);
                            });

                            if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
                                throw new Error('ZIP download failed — file is empty');
                            }

                            const fileSizeMB = (fs.statSync(filePath).size / 1048576).toFixed(2);

                            // ── Send ZIP as document ──────────────────────────
                            await sock.sendMessage(chatId, {
                                document: fs.readFileSync(filePath),
                                mimetype: 'application/zip',
                                fileName: `${GITHUB_REPO}-${selectedBranch}.zip`,
                                caption:
                                    `📦 *${GITHUB_REPO}*\n` +
                                    `🌿 *Branch:* \`${selectedBranch}\`\n` +
                                    `🎲 *Size:* ${fileSizeMB} MB\n` +
                                    `> ${config.botName}`,
                            }, { quoted: zipMsg });

                            await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });

                        } catch (err) {
                            console.error('[GitHub] ZIP download error:', err.message);
                            await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } });
                            await sock.sendMessage(chatId, {
                                text: `🚫 Failed to download ZIP: ${err.message}\n\n_Try copying the link instead._`,
                            }, { quoted: zipMsg });
                        } finally {
                            // Always clean up temp file
                            if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
                        }
                    };

                    sock.ev.on('messages.upsert', handleOpenZip);
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
