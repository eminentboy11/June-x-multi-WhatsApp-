const config = require('../../config');
const { loadCommands } = require('../../utils/commandLoader');
const { generateWAMessageFromContent } = require('@whiskeysockets/baileys');
const { applyFont } = require('../../utils/fontConverter');
const fs = require('fs');
const path = require('path');
const os = require('os');

const MENU_SETTINGS_FILE = path.join(__dirname, '../../data/menuSettings.json');

const detectPlatform = () => {
  if (process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID) return "🚉 Railway";
  if (process.env.DYNO) return "☁️ Heroku";
  if (process.env.RENDER) return "⚡ Render";
  if (process.env.REPL_ID || process.env.REPL_SLUG) return "🔵 Replit";
  if (process.env.PREFIX && process.env.PREFIX.includes("termux")) return "📱 Termux";
  if (process.env.PORTS && process.env.CYPHERX_HOST_ID) return "🌀 CypherX Platform";
  if (process.env.P_SERVER_UUID) return "🖥️ Panel";
  if (process.env.LXC) return "📦 Linux Container (LXC)";
  switch (os.platform()) {
    case "win32": return "🪟 Windows";
    case "darwin": return "🍎 macOS";
    case "linux": return "🐧 Linux";
    default: return "❓ Unknown";
  }
};

function getMenuStyle() {
  try {
    const runtimeSettings = require('../../utils/settings');
    const fromStore = runtimeSettings.get('menuStyle');
    if (fromStore && fromStore !== '1') return fromStore;
    if (!fs.existsSync(MENU_SETTINGS_FILE)) return fromStore || '1';
    return JSON.parse(fs.readFileSync(MENU_SETTINGS_FILE, 'utf8')).menuStyle || fromStore || '1';
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
  const percentage = Math.round((used / total) * size);
  const bar = '█'.repeat(percentage) + '░'.repeat(size - percentage);
  return `[${bar}] ${Math.round((used / total) * 100)}%`;
};

const CATEGORY_ORDER = [
  'general', 'ai', 'admin', 'owner', 'media',
  'sports', 'fun', 'utility', 'anime', 'textmaker',
];

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
};

function buildMenuText(categories, extra, totalCount, speed) {
  const prefix = config.prefix;
  const bot = config.botName || 'June Ultra';
  const ownerName = (Array.isArray(config.ownerName) ? config.ownerName[0] : config.ownerName) || 'Bot Owner';
  const hostName = detectPlatform();
  const uptimeFormatted = formatUptime();
  const { getModeLabel } = require('../../utils/botMode');
  const currentMode = getModeLabel();
  const totalMemory = os.totalmem();
  const botUsedMemory = process.memoryUsage().rss;
  const systemUsedMemory = totalMemory - os.freemem();
  const readmore = String.fromCharCode(8206).repeat(4001);
  const ping = Number.isInteger(speed) ? `${speed}` : speed.toFixed(2);

  let menu =  `┏━━❐ ◉ ${bot} ◉ ❐\n`;
  menu += `┃ *ᴘʀᴇꜰɪx:* [ ${prefix} ]\n`;
  menu += `┃ *ᴏᴡɴᴇʀ:* ${ownerName}\n`;
  menu += `┃ *ᴍᴏᴅᴇ:* ${currentMode}\n`;
  menu += `┃ *ᴘʟᴀᴛꜰᴏʀᴍ:* ${hostName}\n`;
  menu += `┃ *ꜱᴘᴇᴇᴅ:* ${ping} ms\n`;
  menu += `┃ *ᴜᴘᴛɪᴍᴇ:* ${uptimeFormatted}\n`;
  menu += `┃ *Vᴇʀꜱɪᴏɴ:* v${config.version}\n`;
  menu += `┃ *ᴜꜱᴀɢᴇ:* ${formatMemory(botUsedMemory)} of ${formatMemory(totalMemory)}\n`;
  menu += `┃ *ʀᴀᴍ:* ${progressBar(systemUsedMemory, totalMemory)}\n`;
  menu += `┃ *Cᴏᴍᴍᴀɴᴅꜱ:* ${totalCount}\n`;
  menu += `┗❐\n${readmore}\n`;

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
    menu += `┏━━❐◆ \`${label}\` ◆❐\n`;
    for (const cmd of cmds) {
      menu += `┃➧ ${cmd.name}\n`;
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
  const customPath = path.join(__dirname, '../../data/custom_menu.jpg');
  if (fs.existsSync(customPath)) {
    try { return fs.readFileSync(customPath); } catch {}
  }
  const defaults = [
    path.join(__dirname, '../../assets/menu1.jpg'),
    path.join(__dirname, '../../utils/bot_image.jpg'),
    path.join(__dirname, '../../utils/menu2.jpg'),
    path.join(__dirname, '../../utils/menu3.jpg'),
    path.join(__dirname, '../../utils/menu4.jpg'),
    path.join(__dirname, '../../utils/menu5.jpg'),
  ];
  const available = defaults.filter(p => { try { return fs.existsSync(p); } catch { return false; } });
  if (!available.length) return null;
  const picked = available[Math.floor(Math.random() * available.length)];
  try { return fs.readFileSync(picked); } catch { return null; }
}

module.exports = {
  name: 'menu',
  aliases: ['menulist', 'fullmenu'],
  category: 'utility',
  description: 'Show all available commands',
  usage: '.menu',

  async execute(sock, msg, args, extra) {
    try {
      const commands = loadCommands();
      const categories = {};
      let uniqueCount = 0;

      commands.forEach((cmd, name) => {
        if (cmd.name === name) {
          if (!categories[cmd.category]) categories[cmd.category] = [];
          categories[cmd.category].push(cmd);
          uniqueCount++;
        }
      });

      const menustyle = getMenuStyle();

      // ── Loading message ─────────────────────────────────────────────────
      const loadingMsg = await sock.sendMessage(extra.from, {
        text: applyFont('⏳ Loading....')
      }, { quoted: msg });

      const markDone = () => sock.sendMessage(extra.from, {
        text: applyFont(`_${config.botName} Menu Loaded.._`),
        edit: loadingMsg.key
      }).catch(() => {});

      // ────────────────────────────────────────────────────────────────────

      const msgTimestamp = msg.messageTimestamp
        ? msg.messageTimestamp * 1000
        : Date.now();
      const speedMs = Date.now() - msgTimestamp;

      const menulist = buildMenuText(categories, extra, uniqueCount, speedMs);
      const tylorkids = getThumbnail();
      const botname = config.botName || 'June Ultra';
      const ownername = (Array.isArray(config.ownerName) ? config.ownerName[0] : config.ownerName) || 'Bot Owner';
      const plink = config.social?.github || 'https://github.com';
      const chatId = extra.from;
      const fullMenu = applyFont(menulist + `\n> © Supreme`);

      if (menustyle === '1') {
        await sock.sendMessage(chatId, {
          document: { url: "https://i.ibb.co/2W0H9Jq/avatar-contact.png" },
          caption: fullMenu,
          mimetype: "application/pdf",
          fileName: `${botname}.pdf`,
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
        await markDone();

      } else if (menustyle === '2') {
        // ── Simple text reply — no buttons ─────────────────────────────
        await sock.sendMessage(chatId, {
          text: fullMenu,
          mentions: [extra.sender],
        }, { quoted: msg });
        await markDone();

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
        await markDone();

      } else if (menustyle === '4') {
        await sock.sendMessage(chatId, {
          image: tylorkids || { url: "https://i.ibb.co/2W0H9Jq/avatar-contact.png" },
          caption: fullMenu,
          mentions: [extra.sender],
        }, { quoted: msg });
        await markDone();

      } else if (menustyle === '5') {
        try {
          let massage = generateWAMessageFromContent(chatId, {
            viewOnceMessage: {
              message: {
                interactiveMessage: {
                  body: { text: null },
                  footer: { text: fullMenu },
                  nativeFlowMessage: { buttons: [{ text: null }] },
                },
              },
            },
          }, { quoted: msg, userJid: sock.user?.id });
          await sock.relayMessage(chatId, massage.message, { messageId: massage.key.id });
          await markDone();
        } catch {
          await sock.sendMessage(chatId, { text: fullMenu, mentions: [extra.sender] }, { quoted: msg });
          await markDone();
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
                    externalAdReply: { showAdAttribution: false },
                  },
                },
              },
            },
          }, {});
          await markDone();
        } catch {
          await sock.sendMessage(chatId, { text: fullMenu, mentions: [extra.sender] }, { quoted: msg });
          await markDone();
        }

      } else {
        await sock.sendMessage(chatId, {
          text: fullMenu,
          mentions: [extra.sender],
        }, { quoted: msg });
        await markDone();
      }

    } catch (error) {
      console.error('Menu error:', error);
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};
