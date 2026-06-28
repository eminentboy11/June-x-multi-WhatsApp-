module.exports = [
  {
    name: 'waifu',
    aliases: ['randomwaifu'],
    category: 'fun',
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
  },
  {
    name: 'neko',
    aliases: ['catgirl', 'nekogirl'],
    category: 'fun',
    description: 'Get a random SFW neko image',
    usage: '.neko',

    async execute(sock, msg, args, extra) {
      await extra.react('🐱');
      try {
        await sock.sendMessage(msg.key.remoteJid, {
          image: { url: 'https://api.shizo.top/sfw/neko?apikey=shizo' },
          caption: '🐱 *Random Neko*'
        }, { quoted: msg });
        await extra.react('✅');
      } catch (e) {
        await extra.react('❌');
        await extra.reply(`❌ Error: ${e.message}`);
      }
    }
  },
  {
    name: 'loli',
    aliases: ['animeloli'],
    category: 'anime',
    description: 'Get a random SFW happy anime image',
    usage: '.happy',

    async execute(sock, msg, args, extra) {
      await extra.react('😜');
      try {
        await sock.sendMessage(msg.key.remoteJid, {
          image: { url: 'https://api.shizo.top/sfw/loli?apikey=shizo' },
          caption: '😊 *loli Anime*'
        }, { quoted: msg });
        await extra.react('✅');
      } catch (e) {
        await extra.react('❌');
        await extra.reply(`❌ Error: ${e.message}`);
      }
    }
  },
  {
    name: 'shota',
    aliases: ['animeshota'],
    category: 'anime',
    description: 'Get a random SFW sad anime image',
    usage: '.shota',

    async execute(sock, msg, args, extra) {
      await extra.react('😢');
      try {
        await sock.sendMessage(msg.key.remoteJid, {
          image: { url: 'https://api.shizo.top/sfw/shota?apikey=shizo' },
          caption: '😢 *Sad Anime*'
        }, { quoted: msg });
        await extra.react('✅');
      } catch (e) {
        await extra.react('❌');
        await extra.reply(`❌ Error: ${e.message}`);
      }
    }
  },
  {
    name: 'husby',
    aliases: ['husband', 'husbando'],
    category: 'anime',
    description: 'Get a random SFW anime husby image',
    usage: '.husby',

    async execute(sock, msg, args, extra) {
      await extra.react('💙');
      try {
        await sock.sendMessage(msg.key.remoteJid, {
          image: { url: 'https://api.shizo.top/sfw/husbando?apikey=shizo' },
          caption: '💙 *Random Husby*'
        }, { quoted: msg });
        await extra.react('✅');
      } catch (e) {
        await extra.react('❌');
        await extra.reply(`❌ Error: ${e.message}`);
      }
    }
  }
];
