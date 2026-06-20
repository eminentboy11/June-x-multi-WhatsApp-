const { applyFont } = require('../../utils/fontConverter');
const axios  = require('axios');
const config = require('../../config');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');

function parseGitHubUrl(input) {
    try {
        const cleaned = input
            .replace(/^(https?:\/\/)?(www\.)?github\.com\//, '')
            .replace(/\.git$/, '')
            .trim();
        const parts = cleaned.split('/').filter(Boolean);
        if (parts.length < 2) return null;
        return { owner: parts[0], repo: parts[1] };
    } catch {
        return null;
    }
}

module.exports = {
    name: 'gitclone',
    aliases: ['gclone', 'clonerepo'],
    category: 'general',
    description: 'Download any public GitHub repository as a ZIP',
    usage: '.gitclone <github url>',
    ownerOnly: false,

    async execute(sock, msg, args, extra) {
        const chatId = extra.from;
        const prefix = config.prefix || '.';
        const input  = args.join(' ').trim();

        if (!input) {
            return extra.reply(
                applyFont(
                    `┏━━『 GITCLONE 』━━\n\n` +
                    `➥ Usage ➜ ${prefix}gitclone <github url>\n\n` +
                    `➥ Example:\n` +
                    `   ${prefix}gitclone https://github.com/owner/repo\n\n` +
                    `┗━━━━━━━━━━━━━━━━`
                )
            );
        }

        const parsed = parseGitHubUrl(input);
        if (!parsed) {
            return extra.reply(
                applyFont(
                    `┏━━『 GITCLONE ERROR 』━━\n\n` +
                    `➥ Invalid GitHub URL\n` +
                    `➥ Expected: https://github.com/owner/repo\n\n` +
                    `┗━━━━━━━━━━━━━━━━`
                )
            );
        }

        const { owner, repo } = parsed;

        await sock.sendMessage(chatId, { react: { text: '⏳', key: msg.key } });

        let defaultBranch = 'main';
        let repoName      = repo;

        try {
            const { data: repoData } = await axios.get(
                `https://api.github.com/repos/${owner}/${repo}`,
                { headers: { 'User-Agent': 'June_X_Ultra' }, timeout: 10000 }
            );
            defaultBranch = repoData.default_branch || 'main';
            repoName      = repoData.name || repo;
        } catch {
            // fall back to main
        }

        const zipUrl  = `https://github.com/${owner}/${repo}/archive/refs/heads/${defaultBranch}.zip`;
        const dateNow = Date.now();
        let filePath;

        try {
            filePath = path.join(os.tmpdir(), `${repoName}-${dateNow}.zip`);

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
                fileName: `${repoName}.zip`,
                caption: applyFont(
                    `┏━━『 GITCLONE ZIP 』━━\n\n` +
                    `➥ Repository ➜ ${owner}/${repoName}\n` +
                    `➥ Branch     ➜ ${defaultBranch}\n` +
                    `➥ Size       ➜ ${fileSizeMB} MB\n\n` +
                    `┗━━━━━━━━━━━━━━━━\n\n` +
                    `> ${config.botName}`
                ),
            }, { quoted: msg });

            await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });

        } catch (err) {
            console.error('[GitClone] error:', err.message);
            await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } });
            await extra.reply(
                applyFont(
                    `┏━━『 GITCLONE ERROR 』━━\n\n` +
                    `➥ Failed  ➜ ZIP Download\n` +
                    `➥ Reason  ➜ ${err.message}\n\n` +
                    `  Make sure the repo is public.\n\n` +
                    `┗━━━━━━━━━━━━━━━━`
                )
            );
        } finally {
            if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
    }
};
