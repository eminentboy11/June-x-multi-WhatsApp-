/**
 * Shell Command — Execute terminal commands from WhatsApp
 * Owner only. Runs any shell command and returns the output.
 *
 * Usage:
 *   .shell <command>
 *   .$ <command>
 *   .exec <command>
 *   .terminal <command>
 *
 * Examples:
 *   .shell ls
 *   .shell ls -la
 *   .shell pwd
 *   .shell cat package.json
 *   .shell ps aux
 *   .shell df -h
 *   .shell free -m
 *   .shell uptime
 *   .shell env
 *   .shell node -v
 *   .shell npm list --depth=0
 *   .shell mkdir newfolder
 *   .shell rm -rf /tmp/test
 *   .shell kill <pid>
 *   .shell echo "hello world"
 */

const { exec } = require('child_process');

const MAX_OUTPUT  = 3500;   // WhatsApp message char limit buffer
const TIMEOUT_MS  = 30000;  // 30 seconds max per command

module.exports = {
  name: 'shell',
  aliases: ['$', 'exec', 'terminal', 'bash', 'term', 'sh', 'cmd'],
  category: 'owner',
  description: 'Execute a terminal/shell command on the server',
  usage: '.shell <command>',
  ownerOnly: true,

  async execute(sock, msg, args, extra) {
    const { from, reply } = extra;

    if (!args || args.length === 0) {
      return reply(
        `💻 *Shell Command*\n\n` +
        `*Usage:* \`.shell <command>\`\n\n` +
        `*Examples:*\n` +
        `  \`.shell ls\`\n` +
        `  \`.shell ls -la\`\n` +
        `  \`.shell pwd\`\n` +
        `  \`.shell ps aux\`\n` +
        `  \`.shell df -h\`\n` +
        `  \`.shell free -m\`\n` +
        `  \`.shell uptime\`\n` +
        `  \`.shell node -v\`\n` +
        `  \`.shell npm list --depth=0\`\n` +
        `  \`.shell cat package.json\`\n` +
        `  \`.shell env | grep NODE\`\n` +
        `  \`.shell echo "hello"\``
      );
    }

    const command = args.join(' ');

    // Send a "running" indicator
    await sock.sendMessage(from, {
      text: `💻 *Running:* \`${command}\`\n⏳ _Please wait..._`
    }, { quoted: msg });

    try {
      const output = await runCommand(command);
      const readmore = String.fromCharCode(8206).repeat(4001);

      let result = output.stdout || '';
      let stderr  = output.stderr || '';
      let truncated = false;

      // Combine stdout + stderr
      let full = result;
      if (stderr) full += (full ? '\n\n[stderr]\n' : '[stderr]\n') + stderr;

      if (full.length > MAX_OUTPUT) {
        full = full.slice(0, MAX_OUTPUT);
        truncated = true;
      }

      const exitLine = output.code === 0
        ? `✅ *Exit:* 0`
        : `❌ *Exit:* ${output.code}`;

      const body =
        `💻 *Shell Output*\n${readmore}\n` +
        `📌 *Command:* \`${command}\`\n` +
        `${exitLine}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        (full ? `\`\`\`\n${full}\n\`\`\`` : '_No output_') +
        (truncated ? `\n\n_...output truncated at ${MAX_OUTPUT} characters_` : '');

      await sock.sendMessage(from, { text: body }, { quoted: msg });

    } catch (err) {
      const readmore = String.fromCharCode(8206).repeat(4001);
      await sock.sendMessage(from, {
        text:
          `💻 *Shell Error*\n${readmore}\n` +
          `📌 *Command:* \`${command}\`\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `❌ ${err.message}`
      }, { quoted: msg });
    }
  }
};

/**
 * Execute a shell command and return { stdout, stderr, code }.
 */
function runCommand(command) {
  return new Promise((resolve, reject) => {
    const proc = exec(
      command,
      {
        timeout: TIMEOUT_MS,
        maxBuffer: 1024 * 1024 * 5,  // 5 MB buffer
        cwd: process.cwd(),
        shell: '/bin/bash'
      },
      (error, stdout, stderr) => {
        if (error && error.killed) {
          return reject(new Error(`Command timed out after ${TIMEOUT_MS / 1000}s`));
        }
        resolve({
          stdout: stdout?.trim() || '',
          stderr: stderr?.trim() || '',
          code: error?.code ?? 0
        });
      }
    );
  });
}
