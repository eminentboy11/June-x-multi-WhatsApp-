/**
 * Read Receipts Command - Manage read receipts privacy (Owner Only)
 * Persisted in database/bot-settings.json via database.js
 */
const db = require('../../database');

const KEY = 'readReceipts';

function loadConfig() {
    return { readReceipts: db.getBotSetting(KEY) || 'all' };
}

function saveConfig(cfg) {
    db.setBotSetting(KEY, cfg.readReceipts || 'all');
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

            if (opt === 'on') {
                saveConfig({ readReceipts: 'all' });
                await sock.updateReadReceiptsPrivacy('all');
                return await sock.sendMessage(chatId, {
                    text: `✅ *Read Receipts turned ON*\n\nEveryone will see blue ticks when you read messages.`
                }, { quoted: msg });
            }

            if (opt === 'contacts') {
                saveConfig({ readReceipts: 'contacts' });
                await sock.updateReadReceiptsPrivacy('contacts');
                return await sock.sendMessage(chatId, {
                    text: `👥 *Read Receipts set to CONTACTS*\n\nOnly your contacts will see blue ticks.`
                }, { quoted: msg });
            }

            if (opt === 'off') {
                saveConfig({ readReceipts: 'none' });
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
