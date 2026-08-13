const config = require('../../config');
const { loadCommands } = require('../../utils/commandLoader');
const { generateWAMessageFromContent } = require('@whiskeysockets/baileys');
const { sendButtons } = require('gifted-btns');
const { applyFont } = require('../../utils/fontConverter');
const database = require('../../database');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Create fake contact for enhanced replies
function createFakeContact(msg) {
    const jid = msg.key.participant?.split('@')[0] || msg.key.remoteJid?.split('@')[0] || '0';
    return {
        key: {
            participants: "0@s.whatsapp.net",
            remoteJid: "0@s.whatsapp.net",
            fromMe: false,
            id: "JUNE-X"
        },
        message: {
            contactMessage: {
                vcard: `BEGIN:VCARD\nVERSION:3.0\nN:Sy;Bot;;;\nFN:JUNE X\nitem1.TEL;waid=${jid}:${jid}\nitem1.X-ABLabel:Ponsel\nEND:VCARD`
            }
        },
        participant: "0@s.whatsapp.net"
    };
}

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

function getMenuSettings() {
  // Menu presentation has one source of truth: SQLite bot_settings.
  return database.getMenuSettings();
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
  general:   'GEN-CMD',
  ai:        'AI-CMD',
  admin:     'ADM-CMD',
  owner:     'OWN-CMD',
  media:     'MEDIA-CMD',
  sports:    'SPORT-CMD',
  fun:       'FUN-CMD',
  utility:   'UTIL-CMD',
  anime:     'ANIME-CMD',
  textmaker: 'MAKER-CMD',
};

function buildMenuText(categories, extra, totalCount, speed, menuSettings) {
  const prefix = config.prefix;
  const bot = config.botName || 'JuneX-Ultra';
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

  let menu =  `┏━━❐◈  ${bot} ◈\n`;
  menu += `┃ ᴘʀᴇꜰɪx: [ ${prefix} ]\n`;
  menu += `┃ ᴏᴡɴᴇʀ: ${ownerName}\n`;
  menu += `┃ ᴍᴏᴅᴇ: ${currentMode}\n`;
  menu += `┃ ᴘʟᴀᴛꜰᴏʀᴍ: ${hostName}\n`;
  menu += `┃ ꜱᴘᴇᴇᴅ: ${ping} ms\n`;
  if (menuSettings.showUptime) {
    menu += `┃ ᴜᴘᴛɪᴍᴇ: ${uptimeFormatted}\n`;
  }
  menu += `┃ Vᴇʀꜱɪᴏɴ: v${config.version}\n`;
  if (menuSettings.showMemory) {
    menu += `┃ ᴜꜱᴀɢᴇ: ${formatMemory(botUsedMemory)} of ${formatMemory(totalMemory)}\n`;
  }
  if (menuSettings.showProgressBar) {
    menu += `┃ ʀᴀᴍ: ${progressBar(systemUsedMemory, totalMemory)}\n`;
  }
  if (menuSettings.showPluginCount) {
    menu += `┃ Cᴏᴍᴍᴀɴᴅꜱ: ${totalCount}\n`;
  }
  menu += `┗❐◈\n${readmore}\n`;

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
    menu += `┏━━❐◈  \`${label}\` ◈\n`;
    for (const cmd of cmds) {
      menu += `┃◈${cmd.name}\n`;
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
  // Custom images are decoded directly from SQLite. No runtime image copy is
  // needed because every supported menu style accepts a Buffer thumbnail.
  const customImage = database.getMenuImageSettings();
  if (customImage.custom && customImage.imageData) {
    try {
      const buffer = Buffer.from(customImage.imageData, 'base64');
      if (buffer.length >= 100) return buffer;
    } catch (_) {}
  }

  // These are bundled, read-only fallback assets. Do not include paths that
  // older releases used as mutable custom-image copies.
  const defaults = [
    path.join(__dirname, '../../utils/menu1.jpg'),
    path.join(__dirname, '../../utils/menu2.jpg'),
    path.join(__dirname, '../../utils/menu3.jpg'),
    path.join(__dirname, '../../utils/menu4.jpg'),
    path.join(__dirname, '../../utils/menu5.jpg'),
  ];
  const available = defaults.filter(filePath => {
    try { return fs.existsSync(filePath); } catch (_) { return false; }
  });
  if (!available.length) return null;

  const picked = available[Math.floor(Math.random() * available.length)];
  try { return fs.readFileSync(picked); } catch (_) { return null; }
}

module.exports = {
  name: 'menu',
  aliases: ['menulist', 'fullmenu'],
  category: 'general',
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

      const menuSettings = getMenuSettings();
      const menustyle = menuSettings.menuStyle;
      const fakeQuoted = createFakeContact(msg);

      // ── Loading message ─────────────────────────────────────────────────
      const loadingMsg = await sock.sendMessage(extra.from, {
        text: applyFont('⏳ Loading....')
      }, { quoted: fakeQuoted });

      const markDone = () => sock.sendMessage(extra.from, {
        text: applyFont(`_${config.botName} Loaded.._`),
        edit: loadingMsg.key
      }).catch(() => {});

      const msgTimestamp = msg.messageTimestamp
        ? msg.messageTimestamp * 1000
        : Date.now();
      const speedMs = Date.now() - msgTimestamp;

      const menulist = buildMenuText(categories, extra, uniqueCount, speedMs, menuSettings);
      const tylorkids = getThumbnail();
      const botname = config.botName || 'June Ultra';
      const ownername = (Array.isArray(config.ownerName) ? config.ownerName[0] : config.ownerName) || 'Bot Owner';
      const plink = config.social?.github || 'https://github.com';
      const chatId = extra.from;
      const fullMenu = applyFont(menulist + `\n> ${config.botName}`);
      const supreme = `Powered by ${ownername}`;

      if (menustyle === '1') {
        await sock.sendMessage(chatId, {
          document: { url: "https://i.ibb.co/2W0H9Jq/avatar-contact.png" },
          caption: fullMenu,
          mimetype: "application/zip",
          fileName: `${botname}.zip`,
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
        }, { quoted: fakeQuoted });
        await markDone();

      } else if (menustyle === '2') {
        // ── Text only, no buttons ──────────────────────────────────────
        await sock.sendMessage(chatId, {
          text: fullMenu,
          footer: supreme,
          mentions: [extra.sender],
        }, { quoted: fakeQuoted });
        await markDone();

      } else if (menustyle === '3') {
        // ── Text + contextInfo + cta_url (Open Repo) + ping button ─────
        const prefix  = config.prefix || '.';
        const repoUrl = config.social?.github || 'https://github.com';

        await sendButtons(sock, chatId, {
          image: tylorkids ? { buffer: tylorkids, mimetype: 'image/jpeg' } : undefined,
          text: fullMenu,
          footer: supreme,
          mentions: [extra.sender],
          contextInfo: {
            externalAdReply: {
              showAdAttribution: false,
              title: botname,
              body: ownername,
              thumbnail: tylorkids,
              sourceUrl: repoUrl,
              mediaType: 1,
              renderLargerThumbnail: true,
            },
          },
          buttons: [
            {
              name: 'cta_url',
              buttonParamsJson: JSON.stringify({
                display_text: '🔗 𝙾𝙿𝙴𝙽 𝚁𝙴𝙿𝙾',
                url: repoUrl,
              }),
            },
            {
              id:   `${prefix}ping`,
              text: '📍 𝙿𝙸𝙽𝙶',
            },
          ],
        }, { quoted: fakeQuoted });
        await markDone();

      } else if (menustyle === '4') {
        await sock.sendMessage(chatId, {
          image: tylorkids || { url: "https://i.ibb.co/2W0H9Jq/avatar-contact.png" },
          caption: fullMenu,
          mentions: [extra.sender],
        }, { quoted: fakeQuoted });
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
          }, { quoted: fakeQuoted, userJid: sock.user?.id });
          await sock.relayMessage(chatId, massage.message, { messageId: massage.key.id });
          await markDone();
        } catch {
          await sock.sendMessage(chatId, { text: fullMenu, mentions: [extra.sender] }, { quoted: fakeQuoted });
          await markDone();
        }

      } else if (menustyle === '6') {
        try {
          const message = generateWAMessageFromContent(chatId, {
            requestPaymentMessage: {
              currencyCodeIso4217: 'USD',
              requestFrom: '0@s.whatsapp.net',
              amount1000: '1',
              noteMessage: {
                extendedTextMessage: {
                  text: fullMenu,
                  contextInfo: {
                    mentionedJid: [extra.sender],
                    externalAdReply: { showAdAttribution: false },
                  },
                },
              },
            },
          }, { quoted: fakeQuoted, userJid: sock.user?.id });

          await sock.relayMessage(chatId, message.message, { messageId: message.key.id });
          await markDone();
        } catch {
          await sock.sendMessage(chatId, { text: fullMenu, mentions: [extra.sender] }, { quoted: fakeQuoted });
          await markDone();
        }

      } else {
        await sock.sendMessage(chatId, {
          text: fullMenu,
          mentions: [extra.sender],
        }, { quoted: fakeQuoted });
        await markDone();
      }

    } catch (error) {
      console.error('Menu error:', error);
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};
