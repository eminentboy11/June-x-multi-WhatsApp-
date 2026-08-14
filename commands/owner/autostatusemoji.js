const database = require('../../database');
const loadSettings = () => database.loadSettings();
const saveSettings = (s) => database.saveSettings(s);

/**
 * Extract all pictographic emojis from a string, ignoring whatever
 * separators (comma, space, full-width comma, etc.) the user typed.
 */
function extractEmojis(str) {
    const matches = [...str.matchAll(/\p{Extended_Pictographic}(\u200D\p{Extended_Pictographic})*/gu)];
    return matches.map(m => m[0]).filter(Boolean);
}

module.exports = {
    name: 'autostatusemoji',
    aliases: ['statusemoji', 'ase'],
    category: 'owner',
    description: 'Set the emoji(s) used for status reactions',
    usage: '.autostatusemoji 💙 ✅ 💕 💞 🥰  |  <single emoji>  |  random on/off',
    ownerOnly: true,

    async execute(sock, msg, args, extra) {
        try {
            const settings = loadSettings();
            const raw = args.join(' ').trim();
            const opt = (args[0] || '').toLowerCase();

            // ── random on/off ──
            if (opt === 'random') {
                const val = (args[1] || '').toLowerCase();
                if (val === 'on') {
                    if (!settings.emojiPool.length)
                        return extra.reply('⚠️ Set a pool first: .autostatusemoji 💙 ✅ 💕 💞 🥰');
                    settings.randomEmoji = true;
                    saveSettings(settings);
                    return extra.reply(`🎲 *Random emoji reaction ON*\nPool: ${settings.emojiPool.join('  ')}`);
                }
                if (val === 'off') {
                    settings.randomEmoji = false;
                    saveSettings(settings);
                    return extra.reply('🎲 *Random emoji reaction OFF*');
                }
                return extra.reply('⚠️ Use: .autostatusemoji random on/off');
            }

            // ── no args: show current settings ──
            if (!raw) {
                return extra.reply(
                    `🎭 *AUTOSTATUSEMOJI SETTINGS*\n━━━━━━━━━━━━\n` +
                    `Fixed emoji: *${settings.emoji}*\n` +
                    `Random mode: *${settings.randomEmoji ? '🟢 ON' : '🔴 OFF'}*\n` +
                    `Pool: ${settings.emojiPool.length ? settings.emojiPool.join('  ') : '(none)'}\n` +
                    `━━━━━━━━━━━━\n` +
                    ` ✧ .autostatusemoji 💙 ✅ 💕 💞 🥰  → random pool\n` +
                    ` ✧ .autostatusemoji 💙              → single fixed emoji\n` +
                    ` ✧ .autostatusemoji random on/off`
                );
            }

            // ── Extract all emojis from input (any separator works) ──────────
            // This reliably handles: "💙,✅,💕" / "💙 ✅ 💕" / "💙✅💕" etc.
            const pool = extractEmojis(raw);

            if (!pool.length) {
                return extra.reply('⚠️ No valid emojis found.\nExample: .autostatusemoji 💙 ✅ 💕 💞 🥰');
            }

            if (pool.length === 1) {
                // Single emoji → fixed mode, random OFF
                settings.emoji = pool[0];
                settings.randomEmoji = false;
                saveSettings(settings);
                return extra.reply(`✅ *React emoji set to:* ${pool[0]}\n_(Random mode turned OFF)_`);
            }

            // Multiple emojis → pool mode, random ON
            settings.emojiPool = pool;
            settings.randomEmoji = true;
            saveSettings(settings);
            return extra.reply(
                `✅ *Emoji pool set & random mode ON*\n` +
                `Pool (${pool.length}): ${pool.join('  ')}\n\n` +
                `Each status will react with a random emoji from this list.`
            );

        } catch (error) {
            await extra.reply(`❌ Error: ${error.message}`);
        }
    }
};
