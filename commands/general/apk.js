/**
 * APK Downloader - Search and download APKs from Aptoide
 */

const axios = require('axios');

// Per-chat rate limiting
const downloadRequests = new Map();
const COOLDOWN_MS = 5000;

module.exports = {
  name: 'apk',
  aliases: ['apksearch', 'apkdl'],
  category: 'general',
  description: 'Search and download an APK by app name',
  usage: '.apk <app name>',

  async execute(sock, msg, args, extra) {
    const chatId = extra.from;
    const query = args.join(' ').trim();

    try {
      if (!query || query.length < 2) {
        return extra.reply('❌ Usage: .apk <app name>');
      }

      const last = downloadRequests.get(chatId);
      if (last && Date.now() - last < COOLDOWN_MS) {
        const wait = Math.ceil((COOLDOWN_MS - (Date.now() - last)) / 1000);
        return extra.reply(`⏳ Wait ${wait}s`);
      }
      downloadRequests.set(chatId, Date.now());

      await sock.sendMessage(chatId, { react: { text: '🔍', key: msg.key } });

      const apiUrl = `http://ws75.aptoide.com/api/7/apps/search/query=${encodeURIComponent(query)}/limit=10`;
      const { data } = await axios.get(apiUrl, {
        timeout: 30000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });

      const app = data?.datalist?.list?.[0];
      if (!app?.file?.path_alt) {
        return extra.reply('❌ App not found.');
      }

      const sizeMB = app.size ? (app.size / (1024 * 1024)).toFixed(1) : null;
      const fileName = `${(app.name || 'app').replace(/[^a-zA-Z0-9]/g, '_')}.apk`;

      // Check size before downloading
      try {
        const head = await axios.head(app.file.path_alt, { timeout: 10000 });
        const len = head.headers['content-length'];
        if (len && parseInt(len) > 100 * 1024 * 1024) {
          return extra.reply(`❌ Too large (${sizeMB}MB, max 100MB)`);
        }
      } catch {
        // proceed if size check fails
      }

      await sock.sendMessage(chatId, { react: { text: '⬆️', key: msg.key } });

      await sock.sendMessage(chatId, {
        document: { url: app.file.path_alt },
        fileName,
        mimetype: 'application/vnd.android.package-archive',
      }, { quoted: msg });

      await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });
      console.log('[apk]', app.name, '-', query);

    } catch (error) {
      console.error('[apk]', error.message);
      downloadRequests.delete(chatId);
      await extra.reply('❌ Download failed.');
      await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } });
    }
  }
};
