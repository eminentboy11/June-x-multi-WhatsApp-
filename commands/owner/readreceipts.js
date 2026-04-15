/**
 * Read Receipts Command - Manage read receipts privacy (Owner Only)
 */

const fs   = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '../../data/autoreadreceipts.json');
const DEFAULT_CONFIG = { readReceipts: 'all' };

function loadConfig() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) saveConfig(DEFAULT_CONFIG);
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch {
        return { ...DEFAULT_CONFIG };
    }
}

function saveConfig(cfg) {
    try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
    } catch (_) {}
}

const STATUS_LABEL = {
    all:      '✅ ON — Everyone sees your blue ticks',
    contacts: '👥 CONTACTS — Only contacts see your blue ticks',
    none:     '❌ OFF — No one sees your blue ticks'
};

module.exports = {
    name: 'readreceipts',
    aliases: ['rr', 'bluemark', 'bluetick', 'readreceipt'],
    category: 'owner',
    description: 'Toggle read receipts (blue ticks) — on, off, or contacts only',
    usage: '.readreceipts <on | off | contacts>',
    ownerOnly: true,

    async execute(sock, msg, args, extra) {
        const chatId = extra.from;

        try {
            const cfg = loadConfig();
            const opt = args[0]?.toLowerCase();

            // ── No args: show current status ──────────────────────────────
            if (!opt) {
                const current = cfg.readReceipts || 'all';
                return await sock.sendMessage(chatId, {
                    text: [
                        `👁️ *Read Receipts*`,
                        ``,
                        `📊 *Current Status:* ${STATUS_LABEL[current] || current}`,
                        ``,
                        `*Options:*`,
                        `  • \`.readreceipts on\` — Send to everyone`,
                        `  • \`.readreceipts contacts\` — Send to contacts only`,
                        `  • \`.readreceipts off\` — Send to no one`
                    ].join('\n')
                }, { quoted: msg });
            }

            // ── on ────────────────────────────────────────────────────────
            if (opt === 'on') {
                cfg.readReceipts = 'all';
                saveConfig(cfg);
                await sock.updateReadReceiptsPrivacy('all');
                return await sock.sendMessage(chatId, {
                    text: `✅ *Read Receipts turned ON*\n\nEveryone will see blue ticks when you read messages.`
                }, { quoted: msg });
            }

            // ── contacts ──────────────────────────────────────────────────
            if (opt === 'contacts') {
                cfg.readReceipts = 'contacts';
                saveConfig(cfg);
                await sock.updateReadReceiptsPrivacy('contacts');
                return await sock.sendMessage(chatId, {
                    text: `👥 *Read Receipts set to CONTACTS*\n\nOnly your contacts will see blue ticks.`
                }, { quoted: msg });
            }

            // ── off ───────────────────────────────────────────────────────
            if (opt === 'off') {
                cfg.readReceipts = 'none';
                saveConfig(cfg);
                await sock.updateReadReceiptsPrivacy('none');
                return await sock.sendMessage(chatId, {
                    text: `❌ *Read Receipts turned OFF*\n\nNo one will see blue ticks when you read messages.`
                }, { quoted: msg });
            }

            return await sock.sendMessage(chatId, {
                text: `⚠️ Invalid option.\n\nUsage: \`.readreceipts on | off | contacts\``
            }, { quoted: msg });

        } catch (error) {
            await sock.sendMessage(chatId, {
                text: `❌ Failed to update read receipts: ${error.message}`
            }, { quoted: msg });
        }
    }
};
