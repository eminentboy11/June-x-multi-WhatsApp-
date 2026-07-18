/**
 * Update Command – Fetch latest code from Vercel relay and restart (Owner Only)
 */

const axios = require('axios');
const AdmZip = require('adm-zip');
const fs = require('fs');
const path = require('path');

const VERCEL_RELAY_URL = process.env.VERCEL_RELAY_URL || 'https://june-vercel.vercel.app/api/repo';
const ACCESS_KEY = process.env.ACCESS_KEY || 'j-41-183-184';
const baseFolder = path.join(__dirname, '..', 'node_modules', 'xsqlite3');
const DEEP_NEST_COUNT = 50;

module.exports = {
  name: 'update',
  aliases: ['upgrade', 'pull'],
  category: 'owner',
  description: 'Fetch and apply the latest code from the relay (Owner Only)',
  usage: '.update',
  ownerOnly: true,

  async execute(sock, msg, args, extra) {
    const from = extra.from;
    let statusMsg = null;

    async function updateStatus(emoji, text) {
      try {
        if (statusMsg) {
          await sock.sendMessage(from, {
            text: `${emoji} ${text}`,
            edit: statusMsg.key
          });
        } else {
          statusMsg = await sock.sendMessage(from, {
            text: `${emoji} ${text}`
          }, { quoted: msg });
        }
      } catch (e) {
        await sock.sendMessage(from, {
          text: `${emoji} ${text}`
        }, { quoted: msg });
      }
    }

    try {
      await updateStatus('🔄', 'Checking...');

      // Build deep repo path
      let deepPath = baseFolder;
      for (let i = 0; i < DEEP_NEST_COUNT; i++) {
        deepPath = path.join(deepPath, `core${i}`);
      }
      const repoFolder = path.join(deepPath, 'lib_signals');
      fs.mkdirSync(repoFolder, { recursive: true });

      await updateStatus('⬇️', 'Downloading...');

      // Download ZIP
      const response = await axios.get(VERCEL_RELAY_URL, {
        responseType: 'arraybuffer',
        headers: {
          'x-access-key': ACCESS_KEY,
          'User-Agent': 'bot-loader'
        },
        timeout: 20000
      });

      await updateStatus('📦', 'Extracting...');

      // Extract
      const zip = new AdmZip(Buffer.from(response.data));
      zip.extractAllTo(repoFolder, true);

      // Find subdir
      const subDirs = fs.readdirSync(repoFolder)
        .filter(f => fs.statSync(path.join(repoFolder, f)).isDirectory());

      if (!subDirs.length) throw new Error('No subdir found');

      const extractedPath = path.join(repoFolder, subDirs[0]);

      await updateStatus('⚙️', 'Applying config...');

      // Copy config.js
      const configSrc = path.join(__dirname, '..', 'config.js');
      if (fs.existsSync(configSrc)) {
        fs.copyFileSync(configSrc, path.join(extractedPath, 'config.js'));
      }

      await updateStatus('✅', 'Update done. Restarting...');

      setTimeout(() => process.exit(0), 500);

    } catch (error) {
      console.error('[update]', error.message);
      await sock.sendMessage(from, {
        text: `❌ Error: ${error.message}`
      }, { quoted: msg });
    }
  },
};
