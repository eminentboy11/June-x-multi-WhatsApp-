const { sendButtons } = require('gifted-btns');
const { applyFont }  = require('../../utils/fontConverter');
const axios  = require('axios');
const config = require('../../config');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');

const GITHUB_USER = 'Vinpink2';
const GITHUB_REPO = 'June-Ultra';
const REPO_URL    = `https://github.com/${GITHUB_USER}/${GITHUB_REPO}`;
const API_URL     = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}`;
const MENU_IMAGE  = path.join(__dirname, '../../utils/menu2.jpg');

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

function buildMainButtons(repoUrl, dateNow) {
    const prefix = config.prefix || '.';
    return [
        {
            name: 'cta_url',
            buttonParamsJson: JSON.stringify({
                display_text: '🔗 Open Repo',
                url: repoUrl,
            })
        },
        {
            name: 'cta_copy',
            buttonParamsJson: JSON.stringify({
                display_text: '📋 Copy Repo URL',
                copy_code: repoUrl,
            })
        },
        { id: `${prefix}ghzip_${dateNow}`, text: '📦 Download ZIP' },
    ];
}

module.exports = {
    name: 'github',
    aliases: ['repo', 'git', 'source', 'sc', 'script'],
    category: 'tools',
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
            let repoUrl       = REPO_URL;
            let defaultBranch = 'main';

            try {
                const { data: repo } = await axios.get(API_URL, {
                    headers: { 'User-Agent': 'June_X_Ultra' },
                    timeout: 10000,
                });

                repoUrl       = repo.html_url;
                defaultBranch = repo.default_branch || 'main';

                text = applyFont(
                    `┏━━『 GITHUB REPOSITORY 』━━\n\n` +
                    `➥ Repository  ➜ ${repo.name}\n` +
                    `➥ Owner       ➜ ${repo.owner.login}\n` +
                    `➥ Description ➜ ${repo.description || 'N/A'}\n` +
                    `➥ Language    ➜ ${repo.language || 'N/A'}\n` +
                    `➥ License     ➜ ${repo.license?.name || 'N/A'}\n` +
                    `➥ Branch      ➜ ${defaultBranch}\n` +
                    `➥ Visibility  ➜ ${repo.private ? '🔒 Private' : '🔓 Public'}\n\n` +
                    `┃ Statistics\n` +
                    `➥ Stars       ➜ ${repo.stargazers_count.toLocaleString()}\n` +
                    `➥ Forks       ➜ ${repo.forks_count.toLocaleString()}\n` +
                    `➥ Watchers    ➜ ${repo.watchers_count.toLocaleString()}\n` +
                    `➥ Size        ➜ ${(repo.size / 1024).toFixed(2)} MB\n` +
                    `➥ Issues      ➜ ${repo.open_issues_count.toLocaleString()}\n\n` +
                    `┗━━━━━━━━━━━━━━━━`
                );

            } catch (apiError) {
                console.error('[GitHub] API error:', apiError.message);

                text = applyFont(
                    `┏━━『 GITHUB REPOSITORY 』━━\n\n` +
                    `➥ Bot Name    ➜ ${config.botName}\n` +
                    `➥ Repository  ➜ ${GITHUB_REPO}\n` +
                    `➥ Owner       ➜ ${GITHUB_USER}\n` +
                    `➥ URL         ➜ ${REPO_URL}\n\n` +
                    `⚠️ Could not fetch live stats.\n` +
                    `   Visit the repo for latest info.\n\n` +
                    `┗━━━━━━━━━━━━━━━━`
                );
            }

            // ── Send image fused with info + buttons ──────────────────────────
            const jpegThumbnail = fs.existsSync(MENU_IMAGE)
                ? fs.readFileSync(MENU_IMAGE)
                : undefined;

            await sendButtons(sock, chatId, {
                text,
                footer,
                buttons: buildMainButtons(repoUrl, dateNow),
                ...(jpegThumbnail && { jpegThumbnail }),
            }, { quoted: msg });

            // ── Listen for Download ZIP tap ───────────────────────────────────
            const handleZipTap = async (event) => {
                const messageData = event.messages[0];
                if (!messageData?.message) return;

                const selectedId = extractButtonResponseId(messageData);
                if (!selectedId) return;
                if (selectedId !== `${prefix}ghzip_${dateNow}`) return;
                if (messageData.key?.remoteJid !== chatId) return;

                const responseSender = getResponseSender(messageData);
                if (responseSender !== originalSender) return;

                sock.ev.off('messages.upsert', handleZipTap);

                await sock.sendMessage(chatId, { react: { text: '⏳', key: msg.key } });

                const zipUrl = `${repoUrl}/archive/refs/heads/${defaultBranch}.zip`;
                let filePath;

                try {
                    filePath = path.join(os.tmpdir(), `${GITHUB_REPO}-${dateNow}.zip`);

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

                    await sock.sendMessage(chatId, {
                        document: fs.readFileSync(filePath),
                        mimetype: 'application/zip',
                        fileName: `${GITHUB_REPO}.zip`,
                        caption: applyFont(
                            `┏━━『 ZIP DOWNLOADED 』━━\n\n` +
                            `➥ Repository ➜ ${GITHUB_REPO}\n` +
                            `➥ Branch     ➜ ${defaultBranch}\n` +
                            `➥ Size       ➜ ${fileSizeMB} MB\n\n` +
                            `┗━━━━━━━━━━━━━━━━\n\n` +
                            `> ${config.botName}`
                        ),
                    }, { quoted: messageData });

                    await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });

                } catch (err) {
                    console.error('[GitHub] ZIP download error:', err.message);
                    await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } });
                    await sock.sendMessage(chatId, {
                        text: applyFont(
                            `┏━━『 ERROR 』━━\n\n` +
                            `➥ Failed  ➜ ZIP Download\n` +
                            `➥ Reason  ➜ ${err.message}\n\n` +
                            `  Try copying the link instead.\n\n` +
                            `┗━━━━━━━━━━━━━━━━`
                        ),
                    }, { quoted: messageData });
                } finally {
                    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
                }
            };

            sock.ev.on('messages.upsert', handleZipTap);

            // Auto cleanup after 5 minutes
            setTimeout(() => sock.ev.off('messages.upsert', handleZipTap), 5 * 60 * 1000);

        } catch (error) {
            console.error('[GitHub] command error:', error);
            await extra.reply(`❌ Error: ${error.message}`);
        }
    }
};
