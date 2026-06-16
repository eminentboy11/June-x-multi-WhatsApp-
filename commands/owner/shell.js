const { exec } = require('child_process');

const TIMEOUT_MS = 30000;

module.exports = {
    name: 'shell',
    aliases: ['$', 'exec', 'terminal', 'bash', 'term', 'sh', 'cmd'],
    category: 'owner',
    description: 'Execute a terminal/shell command on the server',
    usage: '.shell <command>',

    async execute(sock, msg, args, extra) {
        const { from, isOwner, reply } = extra;

        if (!isOwner) return;

        if (!args || args.length === 0) return reply('❌ Provide a command.\n\nExample: `.shell ls -la`');

        const command = args.join(' ');

        try {
            const output = await runCommand(command);
            const full = [output.stdout, output.stderr ? `[stderr]\n${output.stderr}` : ''].filter(Boolean).join('\n\n');
            await sock.sendMessage(from, {
                text: full || '_No output_'
            }, { quoted: msg });
        } catch (err) {
            await sock.sendMessage(from, { text: `❌ ${err.message}` }, { quoted: msg });
        }
    }
};

function runCommand(command) {
    return new Promise((resolve, reject) => {
        exec(command, {
            timeout: TIMEOUT_MS,
            maxBuffer: 1024 * 1024 * 50,
            cwd: process.cwd(),
            shell: '/bin/bash'
        }, (error, stdout, stderr) => {
            if (error && error.killed) return reject(new Error(`Command timed out after ${TIMEOUT_MS / 1000}s`));
            resolve({
                stdout: stdout?.trim() || '',
                stderr: stderr?.trim() || '',
                code: error?.code ?? 0
            });
        });
    });
}
