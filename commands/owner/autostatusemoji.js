const { loadSettings, saveSettings, cleanEmoji } = require('../../utils/statusSettings');

module.exports = {
    name: 'autostatusemoji',
    aliases: ['statusemoji'],
    category: 'owner',
    description: 'Set the emoji(s) used for status reactions',
    usage: '.autostatusemoji <emoji> | random on/off | pool <emoji1 emoji2 ...>',
    ownerOnly: true,

    async execute(sock, msg, args, extra) {
        try {
            const settings = loadSettings();
            const opt = (args[0] || '').toLowerCase();

            if (opt === 'random') {
                const val = (args[1] || '').toLowerCase();
                if (val === 'on') {
                    if (!settings.emojiPool.length) return extra.reply('⚠️ Add emojis first: .autostatusemoji pool 💙 💚 🔥');
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

            if (opt === 'pool') {
                const pool = args.slice(1).map(cleanEmoji).filter(Boolean);
                if (!pool.length) return extra.reply('⚠️ Use: .autostatusemoji pool 💙 💚 🔥');
                settings.emojiPool = pool;
                saveSettings(settings);
                return extra.reply(`✅ *Emoji pool set:* ${pool.join(' ')}`);
            }

            if (!opt) {
                return extra.reply(
                    `Current emoji: *${settings.emoji}*\n` +
                    `Random mode: *${settings.randomEmoji ? 'ON' : 'OFF'}*\n` +
                    `Pool: ${settings.emojiPool.join(' ') || '(none)'}`
                );
            }

            // treat as single-emoji set: .autostatusemoji 💙
            const emoji = cleanEmoji(args.join(''));
            if (!emoji) return extra.reply('⚠️ Use: .autostatusemoji <😍>');
            settings.emoji = emoji;
            saveSettings(settings);
            return extra.reply(`✅ *React emoji set to:* ${emoji}`);
        } catch (error) {
            await extra.reply(`❌ Error: ${error.message}`);
        }
    }
};