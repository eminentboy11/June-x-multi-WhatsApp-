const axios = require('axios');
const config = require('../../config');

module.exports = [
  {
    name: 'tiktok',
    aliases: ['tt', 'tiktokdl'],
    category: 'media',
    async execute(sock, msg, args, extra) {
      // Get URL from args or quoted message
      const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      const quotedText =
        quoted?.conversation ||
        quoted?.extendedTextMessage?.text ||
        quoted?.imageMessage?.caption ||
        quoted?.videoMessage?.caption || '';

      const url = args[0] || quotedText.match(/https?:\/\/[^\s]+tiktok\.com[^\s]*/)?.[0];

      if (!url || !url.includes('tiktok.com')) {
        return extra.reply(`❌ Provide a valid TikTok URL!\n\nExample: ${config.prefix}tiktok <url>`);
      }

      await extra.react('⏳');

      try {
        const res = await axios.get('https://ravenn.site/download/tiktokdl3', {
          params: { url },
          timeout: 15000
        });

        if (!res.data?.status || !res.data?.result) {
          await extra.react('❌');
          return extra.reply('❌ Could not download that TikTok video. Try a different URL.');
        }

        await sock.sendMessage(extra.from, {
          video: { url: res.data.result },
          caption: `> *TIKTOK DOWNLOADER*\n\n_Fetched by ${config.botName}_`
        }, { quoted: msg });

        await extra.react('✅');

      } catch (error) {
        console.error('TikTok command error:', error);
        await extra.react('❌');
        await extra.reply('❌ An error occurred while downloading the video!');
      }
    }
  }
];
