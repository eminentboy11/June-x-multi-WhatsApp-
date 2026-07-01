/**
 * Cat Command - Display file contents (Owner Only)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../');

module.exports = {
    name: 'cat',
    aliases: ['rf', '$', 'shell'],
    category: 'owner',
    description: 'Display the contents of a file',
    usage: '.cat <filename>',
    ownerOnly: true,

    async execute(sock, msg, args, extra) {
        const chatId = extra.from;

        if (!args || args.length === 0) {
            return extra.reply('📄 Usage: *.cat <filename>*\nExample: `.cat package.json`');
        }

        const requestedPath = args.join(' ').trim();

        try {
            // Resolve path relative to project root, prevent path traversal outside root
            const resolved = path.resolve(ROOT, requestedPath);
            if (!resolved.startsWith(ROOT)) {
                return extra.reply('🚫 Access denied: path is outside the project directory.');
            }

            if (!fs.existsSync(resolved)) {
                return extra.reply(`❌ File not found: \`${requestedPath}\``);
            }

            const stat = fs.statSync(resolved);
            if (stat.isDirectory()) {
                // List directory contents instead
                const entries = fs.readdirSync(resolved);
                const listing = entries.map(e => {
                    const full = path.join(resolved, e);
                    const isDir = fs.statSync(full).isDirectory();
                    return isDir ? `📁 ${e}/` : `📄 ${e}`;
                }).join('\n');
                const relPath = path.relative(ROOT, resolved) || '.';
                return await sock.sendMessage(chatId, {
                    text: `📂 *Directory: ${relPath}*\n\n${listing || '(empty)'}`
                }, { quoted: msg });
            }

            const sizeKB = (stat.size / 1024).toFixed(1);
            if (stat.size > 500 * 1024) {
                return extra.reply(`❌ File too large (${sizeKB} KB). Max allowed is 500 KB.`);
            }

            const content = fs.readFileSync(resolved, 'utf8');
            const relPath = path.relative(ROOT, resolved);
            const ext = path.extname(resolved).slice(1);

            const header = `📄 *${relPath}* _(${sizeKB} KB)_`;
            const codeBlock = `\`\`\`${ext}\n${content}\n\`\`\``;

            await sock.sendMessage(chatId, {
                text: `${header}\n\n${codeBlock}`
            }, { quoted: msg });

        } catch (err) {
            console.error('[cat] error:', err);
            await extra.reply(`🚫 Error: ${err.message}`);
        }
    }
};
