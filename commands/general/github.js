const { sendButtons } = require('gifted-btns');
const { applyFont }  = require('../../utils/fontConverter');
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

// ── Button builder ────────────────────────────────────────────────────────────

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
        // 6 — Interceptable: bot downloads & sends ZIP directly
        { id: `${prefix}ghzip_${dateNow}`, text: '📦 Get ZIP' },
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
            const chatId         = extra.from;
            const prefix         = config.prefix || '.';
            const originalSender = msg.key?.participant || msg.key?.remoteJid;
            const footer         = `> Powered by ${config.botName}`;
            const dateNow        = Date.now();

            let text;
            let repoUrl      = REPO_URL;
            let defaultBranch = 'main';

            try {
                // ── Live stats from GitHub API ────────────────────────────────
                const { data: repo } = await axios.get(API_URL, {
                    headers: { 'User-Agent': 'June_X_Ultra' },
                    timeout: 10000,
                });

                repoUrl       = repo.html_url;
                defaultBranch = repo.default_branch || 'main';

                text = applyFont(
                    `┏━━『 GITHUB REPOSITORY 』━━\n\n` +
                    `Repository:   ${repo.name}\n` +
                    `Owner:        ${repo.owner.login}\n` +
                    `Description:  ${repo.description || 'N/A'}\n` +
                    `Language:     ${repo.language || 'N/A'}\n` +
                    `License:      ${repo.license?.name || 'N/A'}\n\n` +
                    `Statistics\n` +
                    `Stars:      ${repo.stargazers_count.toLocaleString()}\n` +
                    `Forks:      ${repo.forks_count.toLocaleString()}\n` +
                    `Watchers:   ${repo.watchers_count.toLocaleString()}\n` +
                    `Size:       ${(repo.size / 1024).toFixed(2)} MB\n` +
                    `Visibility: ${repo.private ? 'Private' : 'Public'}\n` +
                    `Branch:     ${defaultBranch}\n\n` +
                    `┗━━━━━━━━━━━━━━━━`
                );

            } catch (apiError) {
                console.error('[GitHub] API error:', apiError.message);

                text = applyFont(
                    `┏━━『 GitHub Repository 』━\n\n` +
                    `Bot Name:    ${config.botName}\n` +
                    `Repository:  ${GITHUB_REPO}\n` +
                    `Owner:       ${GITHUB_USER}\n` +
                    `URL:         ${REPO_URL}\n\n` +
                    `Could not fetch live stats. Visit the repo for latest info.\n\n` +
                    `┗━━━━━━━━━━━━━━━━`
                );
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

                await sock.sendMessage(chatId, { react: { text: '⏳', key: msg.key } });

                // ── Step 3: Download ZIP directly — no branch selection ────────
                const zipUrl = `${repoUrl}/archive/refs/heads/${defaultBranch}.zip`;
                let filePath;

                try {
                    // ✅ os.tmpdir() — always exists on any host
                    filePath = path.join(
                        os.tmpdir(),
                        `${GITHUB_REPO}-${defaultBranch}-${dateNow}.zip`
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

                    // ── Send ZIP as document ──────────────────────────────────
                    await sock.sendMessage(chatId, {
                        document: fs.readFileSync(filePath),
                        mimetype: 'application/zip',
                        fileName: `${GITHUB_REPO}-${defaultBranch}.zip`,
                        caption: applyFont(
                            `${GITHUB_REPO}\n` +
                            `Branch: ${defaultBranch}\n` +
                            `Size:   ${fileSizeMB} MB\n` +
                            `> ${config.botName}`
                        ),
                    }, { quoted: messageData });

                    await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });

                } catch (err) {
                    console.error('[GitHub] ZIP download error:', err.message);
                    await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } });
                    await sock.sendMessage(chatId, {
                        text: applyFont(
                            `Failed to download ZIP: ${err.message}\n\nTry copying the link instead.`
                        ),
                    }, { quoted: messageData });
                } finally {
                    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
                }
            };

            sock.ev.on('messages.upsert', handleZipTap);

        } catch (error) {
            console.error('[GitHub] command error:', error);
            await extra.reply(`❌ Error: ${error.message}`);
        }
    }
};
