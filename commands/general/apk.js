const { keithApi } = require('../../utils/keithApi');

module.exports = {
  name: 'apk',
  aliases: ['apksearch'],
  category: 'general',
  description: 'Search for APK download links',
  usage: '.apk <app name>',

  async execute(sock, msg, args, extra) {
    if (!args.length) return extra.reply('❌ Provide an app name.\n\nExample: *.apk WhatsApp*');
    await extra.react('📱');
    try {
      const data = await keithApi('/search/apk', { q: args.join(' ') });
      const r = data.result || data;
      let text = `📱 *APK: ${args.join(' ')}*\n━━━━━━━━━━━━━━━\n\n`;
      if (typeof r === 'string') { text += r; }
      else if (Array.isArray(r)) {
        for (const app of r.slice(0, 8)) {
          text += `📦 *${app.name || app.title || ''}*\n`;
          if (app.size) text += `   💾 ${app.size}\n`;
          if (app.link || app.url || app.download) text += `   🔗 ${app.link || app.url || app.download}\n`;
          text += '\n';
        }
      } else {
        text += JSON.stringify(r, null, 2).slice(0, 3000);
      }
      await extra.reply(text.trim());
    } catch (e) {
      await extra.reply(`❌ APK search error: ${e.message}`);
    }
  }
};
