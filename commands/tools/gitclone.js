/**
 * Git Clone Command
 * Downloads a GitHub repository as a ZIP file directly to chat
 */

const axios = require('axios');

module.exports = {
    name: 'gitclone',
    aliases: ['gclone', 'ghclone'],
    category: 'tools',
    description: 'Download a GitHub repository as a ZIP file',
    usage: '.gitclone <github-url>',

    async execute(sock, msg, args, extra) {
        try {
            const query = args.join(' ').trim();

            if (!query) return extra.reply(
                '❌ Provide a GitHub repository URL!\n' +
                'Example: .gitclone https://github.com/username/repo'
            );

            const githubRegex = /(?:https?:\/\/)?(?:www\.)?github\.com[\/:]([^\/\n\r]+)\/([^\/\n\r#?]+)(?:[\/]?|[\/]tree[\/]([^\/\n\r]+)?)?/i;
            const match = query.match(githubRegex);

            if (!match) return extra.reply(
                '❌ *Invalid GitHub URL!*\n\n' +
                '*Supported formats:*\n' +
                '• https://github.com/username/repo\n' +
                '• https://github.com/username/repo/tree/branch\n' +
                '• github.com/username/repo'
            );

            let [, user, repo, branch] = match;
            if (!user || !repo) return extra.reply(
                '❌ Could not extract repository info. Use format:\nhttps://github.com/username/repo'
            );

            repo = repo.replace(/\.git$/, '').replace(/[^a-zA-Z0-9\-_]/g, '');
            branch = branch || 'main';

            await sock.sendMessage(extra.from, { react: { text: '🔍', key: msg.key } });
            await extra.reply(`⏳ Fetching *${user}/${repo}* on branch \`${branch}\`...`);

            // Detect valid branch (main → master fallback)
            try {
                await axios.head(`https://api.github.com/repos/${user}/${repo}/branches/${branch}`);
            } catch {
                try {
                    await axios.head(`https://api.github.com/repos/${user}/${repo}/branches/master`);
                    branch = 'master';
                } catch {
                    await sock.sendMessage(extra.from, { react: { text: '❌', key: msg.key } });
                    return extra.reply('❌ Repository or branch not found! Please check the URL and make sure the repo is public.');
                }
            }

            const zipUrl = `https://github.com/${user}/${repo}/archive/refs/heads/${branch}.zip`;
            const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
            const filename = `${repo}-${branch}-${timestamp}.zip`;

            // Get file size if available
            let sizeText = '';
            try {
                const head = await axios.head(zipUrl);
                const fileSize = head.headers['content-length'];
                if (fileSize) {
                    const sizeMB = (fileSize / (1024 * 1024)).toFixed(2);
                    sizeText = ` • ${sizeMB} MB`;
                }
            } catch (_) {}

            await sock.sendMessage(extra.from, {
                document: { url: zipUrl },
                fileName: filename,
                mimetype: 'application/zip',
                caption: `📦 *${user}/${repo}*\n🌿 Branch: \`${branch}\`${sizeText}\n📁 File: ${filename}`
            }, { quoted: msg });

            await sock.sendMessage(extra.from, { react: { text: '✅', key: msg.key } });

        } catch (error) {
            console.error('Gitclone error:', error);

            let errorMessage = `❌ Error: ${error.message}`;
            if (error.response?.status === 404) {
                errorMessage = '❌ Repository not found! Check the URL and make sure it\'s public.';
            } else if (error.response?.status === 403) {
                errorMessage = '❌ GitHub API rate limit exceeded. Try again later.';
            } else if (error.response?.status === 500) {
                errorMessage = '❌ GitHub server error. Try again later.';
            } else if (error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
                errorMessage = '❌ Network error. Check your internet connection.';
            }

            await sock.sendMessage(extra.from, { react: { text: '❌', key: msg.key } });
            await extra.reply(errorMessage);
        }
    }
};
