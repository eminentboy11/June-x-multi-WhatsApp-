// commands/mediafire.js
const axios = require('axios');
const cheerio = require('cheerio');

module.exports = {
  name: 'mediafire',
  aliases: ['mf'],
  category: 'tools',
  description: 'Download a file from a MediaFire link',

  async execute(sock, msg, args, extra) {
    const from = extra.from;
    const url = args[0];

    if (!url || !url.includes('mediafire.com')) {
      return sock.sendMessage(from, {
        text: '◆ *MEDIAFIRE DOWNLOADER*\n\nProvide a valid MediaFire link.\n\n*Usage:* .mediafire <link>'
      }, { quoted: msg });
    }

    await sock.sendMessage(from, { text: '⏳ Fetching file info...' }, { quoted: msg });

    try {
      // Fetch the MediaFire page
      const { data: html } = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
        },
        timeout: 15000
      });

      const $ = cheerio.load(html);

      // Extract direct download link
      const directLink = $('a#downloadButton').attr('href') ||
                         $('a.popsok').attr('href') ||
                         $('[aria-label="Download file"]').attr('href');

      // Extract file name
      const fileName = $('.filename').text().trim() ||
                       $('meta[property="og:title"]').attr('content') ||
                       'downloaded_file';

      // Extract file size
      const fileSize = $('.subheading').first().text().trim() ||
                       $('.file-size').text().trim() || 'Unknown';

      if (!directLink) {
        return sock.sendMessage(from, {
          text: '❌ Could not extract download link. The file may be private or removed.'
        }, { quoted: msg });
      }

      await sock.sendMessage(from, {
        text: `◆ *MEDIAFIRE DOWNLOADER*\n\n☆ *File:* ${fileName}\n◇ *Size:* ${fileSize}\n\n⬇️ Downloading...`
      }, { quoted: msg });

      // Download the file
      const fileResponse = await axios.get(directLink, {
        responseType: 'arraybuffer',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        },
        timeout: 60000,
        maxContentLength: 100 * 1024 * 1024 // 100MB cap
      });

      const buffer = Buffer.from(fileResponse.data);
      const mime = fileResponse.headers['content-type'] || 'application/octet-stream';

      // Send as document
      await sock.sendMessage(from, {
        document: buffer,
        mimetype: mime,
        fileName: fileName,
        caption: `◆ *${fileName}*\n◇ Via MediaFire Downloader`
      }, { quoted: msg });

    } catch (err) {
      console.error('[mediafire]', err.message);
      await sock.sendMessage(from, {
        text: `❌ Failed to download.\n\n_${err.message}_`
      }, { quoted: msg });
    }
  }
};
