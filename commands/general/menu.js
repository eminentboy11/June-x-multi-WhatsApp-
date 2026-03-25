const config = require('../../config');
const { loadCommands } = require('../../utils/commandLoader');
const { generateWAMessageFromContent } = require('@whiskeysockets/baileys');
const { sendButtons } = require('gifted-btns');
const { applyFont } = require('../../utils/fontConverter');
const fs = require('fs');
const path = require('path');
const os = require('os');

const MENU_SETTINGS_FILE = path.join(__dirname, '../../data/menuSettings.json');

function detectPlatform() {
  if (process.env.HEROKU) return '⚙️ Heroku';
  if (process.env.RAILWAY_STATIC_URL) return '🚂 Railway';
  if (process.env.RENDER) return '⚡ Render';
  if (process.env.REPLIT_SLUG || process.env.REPL_ID) return '🔵 Replit';
  if (process.env.P_SERVER_UUID) return '🖥️ Panel';
  switch (os.platform()) {
    case 'win32': return '🪟 Windows';
    case 'darwin': return '🍎 macOS';
    case 'linux': return '🐧 Linux';
    default: return '💻 ' + os.platform();
  }
}

function getMenuStyle() {
  try {
    if (!fs.existsSync(MENU_SETTINGS_FILE)) return '1';
    return JSON.parse(fs.readFileSync(MENU_SETTINGS_FILE, 'utf8')).menuStyle || '1';
  } catch {
    return '1';
  }
}

function formatUptime() {
  const s = Math.floor(process.uptime());
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  parts.push(`${sec}s`);
  return parts.join(' ');
}

function formatMemory(bytes) {
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + ' GB';
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1024).toFixed(0) + ' KB';
}

const progressBar = (used, total, size = 10) => {
  let percentage = Math.round((used / total) * size);
  let bar = '█'.repeat(percentage) + '░'.repeat(size - percentage);
  return `[${bar}] ${Math.round((used / total) * 100)}%`;
};

// Preferred display order for known categories; unknown ones are appended after
const CATEGORY_ORDER = [
  'general', 'ai', 'admin', 'owner', 'media',
  'sports', 'fun', 'utility', 'anime', 'textmaker',
];

// Human-friendly labels for known categories
const CATEGORY_LABELS = {
  general:   'GENERAL-CMD',
  ai:        'AI-CMD',
  admin:     'ADMIN-CMD',
  owner:     'OWNER-CMD',
  media:     'MEDIA-CMD',
  sports:    'SPORTS-CMD',
  fun:       'FUN-CMD',
  utility:   'UTILITY-CMD',
  anime:     'ANIME-CMD',
  textmaker: 'TEXTMAKER-CMD',
  group:     'GROUP-CMD',
};

function buildMenuText(categories, extra, totalCount, speed) {
  const prefix = config.prefix;
  const bot = config.botName || 'June Ultra';
  const ownerName = (Array.isArray(config.ownerName) ? config.ownerName[0] : config.ownerName) || 'Bot Owner';
  const hostName = detectPlatform();
  const uptimeFormatted = formatUptime();
  const currentMode = config.selfMode ? 'Self' : 'Public';
  const totalMemory = os.totalmem();
  const botUsedMemory = process.memoryUsage().rss;
  const systemUsedMemory = totalMemory - os.freemem();
  const readmore = String.fromCharCode(8206).repeat(4001);
  const ping = speed.toFixed(3);

  let menu = `┏━━❐✧ ${bot} ✧❐\n`;
  menu += `┃✦ Prefix: [${prefix}]\n`;
  menu += `┃✦ Owner: ${ownerName}\n`;
  menu += `┃✦ Mode: ${currentMode}\n`;
  menu += `┃✦ Platform: ${hostName}\n`;
  menu += `┃✦ Speed: ${ping} ms\n`;
  menu += `┃✦ Uptime: ${uptimeFormatted}\n`;
  menu += `┃✦ Version: v2.0\n`;
  menu += `┃✦ Usage: ${formatMemory(botUsedMemory)} of ${formatMemory(totalMemory)}\n`;
  menu += `┃✦ RAM: ${progressBar(systemUsedMemory, totalMemory)}\n`;
  menu += `┃✦ Commands: ${totalCount}\n`;
  menu += `┗❐\n${readmore}\n`;

  // Build ordered list: known categories first (in preferred order), then any extras
  const allCategoryKeys = Object.keys(categories).filter(k => categories[k]?.length > 0);
  const ordered = [
    ...CATEGORY_ORDER.filter(k => allCategoryKeys.includes(k)),
    ...allCategoryKeys.filter(k => !CATEGORY_ORDER.includes(k)).sort(),
  ];

  let sectionIndex = 0;
  for (const key of ordered) {
    const cmds = categories[key];
    if (!cmds || cmds.length === 0) continue;

    const label = (CATEGORY_LABELS[key] || `${key.toUpperCase()}-CMD`);
    menu += `┏━━❐ \`${label}\` ❐\n`;
    for (const cmd of cmds) {
      menu += `┃ ${prefix}${cmd.name}\n`;
    }
    menu += `┗❐\n`;
    sectionIndex++;
    if (sectionIndex % 3 === 0) {
      menu += `${readmore}\n`;
    } else {
      menu += `\n`;
    }
  }

  return menu;
}

function getThumbnail() {
  const paths = [
    path.join(__dirname, '../../assets/menu1.jpg'),
    path.join(__dirname, '../../utils/bot_image.jpg'),
    // Permanent fallbacks — never deleted by reset
    path.join(__dirname, '../../assets/menu2.jpg'),
    path.join(__dirname, '../../assets/menu3.jpg'),
    path.join(__dirname, '../../assets/menu4.jpg'),
    path.join(__dirname, '../../assets/menu5.jpg'),
  ];
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p);
    } catch (_) {}
  }
  return null;
}

function getButtons() {
  return [
    {
      name: 'cta_url',
      buttonParamsJson: JSON.stringify({
        display_text: '💻 Bot Repo',
        url: config.social?.github || 'https://github.com/mruniquehacker'
      })
    },
    {
      name: 'cta_url',
      buttonParamsJson: JSON.stringify({
        display_text: '📺 YouTube',
        url: config.social?.youtube || 'http://youtube.com/@mr_unique_hacker'
      })
    }
  ];
}

module.exports = {
  name: 'menu',
  aliases: ['help', 'commands'],
  category: 'general',
  description: 'Show all available commands',
  usage: '.menu',

  async execute(sock, msg, args, extra) {
    try {
      const commands = loadCommands();
      const categories = {};

      commands.forEach((cmd, name) => {
        if (cmd.name === name) {
          if (!categories[cmd.category]) categories[cmd.category] = [];
          categories[cmd.category].push(cmd);
        }
      });

      const menustyle = getMenuStyle();
      const msgTimestamp = (msg.messageTimestamp || 0) * 1000;
      const speedMs = msgTimestamp > 0 ? (Date.now() - msgTimestamp) : 0;
      const menulist = buildMenuText(categories, extra, commands.size, speedMs);
      const tylorkids = getThumbnail();
      const botname = config.botName || 'June Ultra';
      const ownername = (Array.isArray(config.ownerName) ? config.ownerName[0] : config.ownerName) || 'Bot Owner';
      const plink = config.social?.github || 'https://github.com';
      const chatId = extra.from;
      const fullMenu = applyFont(menulist + `\n> *${botname}* v2.0 — Powered by Supreme\n> github.com/Vinpink2`);

      if (menustyle === '1') {
        await sock.sendMessage(chatId, {
          document: { url: "https://i.ibb.co/2W0H9Jq/avatar-contact.png" },
          caption: fullMenu,
          mimetype: "application/zip",
          fileName: `${botname}`,
          fileLength: "9999999",
          contextInfo: {
            mentionedJid: [extra.sender],
            externalAdReply: {
              showAdAttribution: false,
              title: botname,
              body: ownername,
              thumbnail: tylorkids,
              sourceUrl: plink,
              mediaType: 1,
              renderLargerThumbnail: true,
            },
          },
        }, { quoted: msg });

      } else if (menustyle === '2') {
        const footer = `Powered by Supreme\ngithub.com/Vinpink2`;
        const menuTextClean = applyFont(menulist);
        await sendButtons(sock, chatId, {
          title: '',
          text: menuTextClean,
          footer: footer,
          buttons: getButtons(),
        }, { quoted: msg });

      } else if (menustyle === '3') {
        await sock.sendMessage(chatId, {
          text: fullMenu,
          mentions: [extra.sender],
          contextInfo: {
            externalAdReply: {
              showAdAttribution: false,
              title: botname,
              body: ownername,
              thumbnail: tylorkids,
              sourceUrl: plink,
              mediaType: 1,
              renderLargerThumbnail: true,
            },
          },
        }, { quoted: msg });

      } else if (menustyle === '4') {
        await sock.sendMessage(chatId, {
          image: tylorkids || { url: "https://i.ibb.co/2W0H9Jq/avatar-contact.png" },
          caption: fullMenu,
          mentions: [extra.sender],
        }, { quoted: msg });

      } else if (menustyle === '5') {
        try {
          let massage = generateWAMessageFromContent(chatId, {
            viewOnceMessage: {
              message: {
                interactiveMessage: {
                  body: { text: null },
                  footer: { text: fullMenu },
                  nativeFlowMessage: {
                    buttons: [{ text: null }],
                  },
                },
              },
            },
          }, { quoted: msg });
          await sock.relayMessage(chatId, massage.message, { messageId: massage.key.id, quoted: msg });
        } catch {
          await sock.sendMessage(chatId, { text: fullMenu, mentions: [extra.sender] }, { quoted: msg });
        }

      } else if (menustyle === '6') {
        try {
          await sock.relayMessage(chatId, {
            requestPaymentMessage: {
              currencyCodeIso4217: 'USD',
              requestFrom: '0@s.whatsapp.net',
              amount1000: '1',
              noteMessage: {
                extendedTextMessage: {
                  text: fullMenu,
                  contextInfo: {
                    mentionedJid: [msg.key.participant || msg.key.remoteJid],
                    externalAdReply: {
                      showAdAttribution: false,
                    },
                  },
                },
              },
            },
          }, {});
        } catch {
          await sock.sendMessage(chatId, { text: fullMenu, mentions: [extra.sender] }, { quoted: msg });
        }

      } else {
        await sock.sendMessage(chatId, {
          text: fullMenu,
          mentions: [extra.sender],
        }, { quoted: msg });
      }

    } catch (error) {
      console.error('Menu error:', error);
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};
