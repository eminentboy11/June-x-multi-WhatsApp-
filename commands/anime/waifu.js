module.exports = {
  name: 'waifu',
  aliases: ['randomwaifu'],
  category: 'anime',
  description: 'Get a random SFW waifu image',
  usage: '.waifu',

  async execute(sock, msg, args, extra) {
    await extra.react('✨');
    try {
      await sock.sendMessage(msg.key.remoteJid, {
        image: { url: 'https://api.shizo.top/sfw/waifu?apikey=shizo' },
        caption: '✨ *Random Waifu*'
      }, { quoted: msg });

      await extra.react('✅');
    } catch (e) {
      await extra.react('❌');
      await extra.reply(`❌ Error: ${e.message}`);
    }
  }
};
