/**
 * Read Receipts Command - Manage read receipts privacy (Owner Only)
 * Persisted in database/bot-settings.json via database.js
 *
 * Logic:
 *   off (default) → blue ticks  — receipts sent to everyone
 *   on            → grey ticks  — receipts hidden from everyone
 *   contacts      → grey ticks for non-contacts, blue for contacts
 */
const db = require('../../database');

const KEY = 'readReceipts';

function loadConfig() {
    return { readReceipts: db.getBotSetting(KEY) || 'off' };
}

function saveConfig(cfg) {
    db.setBotSetting(KEY, cfg.readReceipts || 'off');
}

// Map stored value → Baileys privacy value
const PRIVACY_MAP = {
    off:      'all',       // receipts OFF  → everyone sees blue ticks
    on:       'none',      // receipts ON   → grey ticks (hidden)
    contacts: 'contacts',  // only contacts see blue ticks
};

const STATUS_LABEL = {
    off:      '🔵 OFF (default) — Everyone sees blue ticks',
    on:       '⚪ ON — Grey ticks (receipts hidden from everyone)',
    contacts: '👥 CONTACTS — Only contacts see blue ticks',
};

module.exports = {
    name: 'readreceipts',
    aliases: ['rr', 'bluemark', 'bluetick', 'readreceipt'],
    category: 'owner',
    description: 'Toggle read receipts — off = blue ticks (default), on = grey ticks',
    usage: '.readreceipts <off | on | contacts>',
    ownerOnly: true,

    async execute(sock, msg, args, extra) {
        const chatId = extra.from;

        try {
            const cfg = loadConfig();
            const opt = args[0]?.toLowerCase();

            if (!opt) {
                const current = cfg.readReceipts || 'off';
                return await sock.sendMessage(chatId, {
                    text: [
                        `👁️ *Read Receipts*`,
                        ``,
                        `📊 *Current Status:* ${STATUS_LABEL[current] || current}`,
                        ``,
                        `*Options:*`,
                        `  • \`.readreceipts off\` — Blue ticks (default)`,
                        `  • \`.readreceipts on\` — Grey ticks (hidden from everyone)`,
                        `  • \`.readreceipts contacts\` — Blue ticks for contacts only`
                    ].join('\n')
                }, { quoted: msg });
            }

            if (opt === 'off') {
                saveConfig({ readReceipts: 'off' });
                await sock.updateReadReceiptsPrivacy('all');
                return await sock.sendMessage(chatId, {
                    text: `🔵 *Read Receipts turned OFF*\n\nEveryone will see blue ticks when you read messages.`
                }, { quoted: msg });
            }

            if (opt === 'on') {
                saveConfig({ readReceipts: 'on' });
                await sock.updateReadReceiptsPrivacy('none');
                return await sock.sendMessage(chatId, {
                    text: `⚪ *Read Receipts turned ON*\n\nMessages will show grey ticks — no one will see that you've read them.`
                }, { quoted: msg });
            }

            if (opt === 'contacts') {
                saveConfig({ readReceipts: 'contacts' });
                await sock.updateReadReceiptsPrivacy('contacts');
                return await sock.sendMessage(chatId, {
                    text: `👥 *Read Receipts set to CONTACTS*\n\nOnly your contacts will see blue ticks.`
                }, { quoted: msg });
            }

            return await sock.sendMessage(chatId, {
                text: `⚠️ Invalid option.\n\nUsage: \`.readreceipts off | on | contacts\``
            }, { quoted: msg });

        } catch (error) {
            await sock.sendMessage(chatId, {
                text: `❌ Failed to update read receipts: ${error.message}`
            }, { quoted: msg });
        }
    },

    // Exposed so index.js can resolve the stored value to a Baileys privacy value
    PRIVACY_MAP,
};
