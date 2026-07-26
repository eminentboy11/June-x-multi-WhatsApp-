const { loadSettings, saveSettings, cleanEmoji } = require('../../database');

module.exports = {
    name: 'autostatusemoji',
    aliases: ['statusemoji'],
    category: 'owner',
    description: 'Set the emoji(s) used for status reactions',
    usage: '.autostatusemoji 💙,✅,💕 | <single emoji> | random on/off | pool <emoji1 emoji2 ...>',
    ownerOnly: true,

    async execute(sock, msg, args, extra) {
        try {
            const settings = loadSettings();
            const raw = args.join(' ').trim();
            const opt = (args[0] || '').toLowerCase();

            // ── Comma-separated list: .autostatusemoji 💙,✅,💕,💞,🥰 ──
            // Automatically sets the pool and enables random mode
            if (raw.includes(',')) {
                const pool = raw
                    .split(',')
                    .map(e => cleanEmoji(e.trim()))
                    .filter(Boolean);

                if (!pool.length) return extra.reply('⚠️ No valid emojis found. Example: .autostatusemoji 💙,✅,💕,💞,🥰');

                settings.emojiPool = pool;
                settings.randomEmoji = true;
                saveSettings(settings);

                return extra.reply(
                    `✅ *Emoji pool set & random mode ON*\n` +
                    `Pool: ${pool.join('  ')}\n\n` +
                    `Each status will react with a random emoji from this list.`
                );
            }

            // ── random on/off ──
            if (opt === 'random') {
                const val = (args[1] || '').toLowerCase();
                if (val === 'on') {
                    if (!settings.emojiPool.length) return extra.reply('⚠️ Add emojis first: .autostatusemoji 💙,✅,💕 or .autostatusemoji pool 💙 💚 🔥');
                    settings.randomEmoji = true;
                    saveSettings(settings);
                    return extra.reply(`🎲 *Random emoji reaction turned ON*\nPool: ${settings.emojiPool.join(' ')}`);
                }
                if (val === 'off') {
                    settings.randomEmoji = false;
                    saveSettings(settings);
                    return extra.reply('🎲 *Random emoji reaction turned OFF*');
                }
                return extra.reply('⚠️ Use: .autostatusemoji random on/off');
            }

            // ── pool <emoji1 emoji2 ...> ──
            if (opt === 'pool') {
                const pool = args.slice(1).map(cleanEmoji).filter(Boolean);
                if (!pool.length) return extra.reply('⚠️ Use: .autostatusemoji pool 💙 💚 🔥\nOr shortcut: .autostatusemoji 💙,💚,🔥');
                settings.emojiPool = pool;
                saveSettings(settings);
                return extra.reply(`✅ *Emoji pool set:* ${pool.join(' ')}\nUse *.autostatusemoji random on* to activate random mode.`);
            }

            // ── no args: show current settings ──
            if (!opt) {
                return extra.reply(
                    `🎭 *AUTOSTATUSEMOJI SETTINGS*\n━━━━━━━━━━━━\n` +
                    `Fixed emoji: *${settings.emoji}*\n` +
                    `Random mode: *${settings.randomEmoji ? '🟢 ON' : '🔴 OFF'}*\n` +
                    `Pool: ${settings.emojiPool.length ? settings.emojiPool.join('  ') : '(none)'}\n` +
                    `━━━━━━━━━━━━\n` +
                    ` ✧ .autostatusemoji 💙,✅,💕,💞,🥰  → random pool\n` +
                    ` ✧ .autostatusemoji 💙  → single fixed emoji\n` +
                    ` ✧ .autostatusemoji random on/off\n` +
                    ` ✧ .autostatusemoji pool 💙 💚 🔥`
                );
            }

            // ── single emoji: .autostatusemoji 💙 ──
            const emoji = cleanEmoji(args.join(''));
            if (!emoji) return extra.reply('⚠️ Use: .autostatusemoji <😍>');
            settings.emoji = emoji;
            settings.randomEmoji = false; // single emoji disables random mode
            saveSettings(settings);
            return extra.reply(`✅ *React emoji set to:* ${emoji}\n_(Random mode turned OFF)_`);

        } catch (error) {
            await extra.reply(`❌ Error: ${error.message}`);
        }
    }
};
