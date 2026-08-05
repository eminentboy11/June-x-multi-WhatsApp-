'use strict';

const fs = require('fs');
const path = require('path');
const {
  downloadMediaMessage,
  normalizeMessageContent,
  jidNormalizedUser
} = require('@whiskeysockets/baileys');
const FOOTER = '⚡ *Engineered by June_Ultra*';
const DATA_DIR = path.join(process.cwd(), 'data', 'autodownloadstatus');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const ALL_TYPES = ['image', 'video', 'audio', 'document', 'sticker', 'text'];
const DEFAULT_CONFIG = {
  enabled: false,
  mode: 'private',
  publicJid: '',
  ownerJid: '',
  downloadTypes: [...ALL_TYPES],
  excludedContacts: [],
  skipOwnerStatus: true,
  totalDownloaded: 0,
  logs: [],
  downloadedIds: []
};

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadConfig() {
  ensureDataDir();
  try {
    const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return {
      ...DEFAULT_CONFIG,
      ...saved,
      downloadTypes: Array.isArray(saved.downloadTypes) ? saved.downloadTypes : [...ALL_TYPES],
      excludedContacts: Array.isArray(saved.excludedContacts) ? saved.excludedContacts : [],
      logs: Array.isArray(saved.logs) ? saved.logs : [],
      downloadedIds: Array.isArray(saved.downloadedIds) ? saved.downloadedIds : []
    };
  } catch (_) {
    return { ...DEFAULT_CONFIG, downloadTypes: [...ALL_TYPES] };
  }
}

function saveConfig(config) {
  ensureDataDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

const manager = {
  config: loadConfig(),
  downloadedIds: new Set(),
  reload() {
    this.config = loadConfig();
    this.downloadedIds = new Set(this.config.downloadedIds || []);
  },
  save() {
    this.config.downloadedIds = Array.from(this.downloadedIds).slice(-300);
    saveConfig(this.config);
  },
  saveSoon() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 2000);
  },
  mark(id) {
    this.downloadedIds.add(id);
    if (this.downloadedIds.size > 400) {
      this.downloadedIds = new Set(Array.from(this.downloadedIds).slice(-250));
    }
    this.saveSoon();
  },
  number(value) {
    return String(value || '').replace(/\D/g, '');
  },
  excluded(statusKey) {
    const candidates = [
      statusKey?.participantPn,
      statusKey?.participant,
      statusKey?.remoteJidAlt,
      statusKey?.remoteJid
    ].map(value => this.number(value)).filter(Boolean);
    return this.config.excludedContacts.some(item => candidates.includes(this.number(item)));
  },
  addLog(sender, type) {
    this.config.logs.push({ sender, type, timestamp: Date.now() });
    this.config.logs = this.config.logs.slice(-100);
    this.config.totalDownloaded = (this.config.totalDownloaded || 0) + 1;
    this.saveSoon();
  },
};
manager.reload();

function getRealNumber(jid) {
  const number = manager.number(jid);
  return number.length >= 7 ? `+${number}` : String(jid || 'Unknown').split('@')[0];
}

function getMediaInfo(content) {
  if (!content) return null;
  if (content.imageMessage) return { type: 'image', media: content.imageMessage, caption: content.imageMessage.caption || '' };
  if (content.videoMessage) return { type: 'video', media: content.videoMessage, caption: content.videoMessage.caption || '' };
  if (content.audioMessage) return { type: 'audio', media: content.audioMessage, caption: '' };
  if (content.documentMessage) return { type: 'document', media: content.documentMessage, caption: content.documentMessage.caption || '' };
  if (content.stickerMessage) return { type: 'sticker', media: content.stickerMessage, caption: '' };
  return null;
}

function getTextInfo(content) {
  const text = content?.extendedTextMessage?.text || content?.conversation;
  return text ? { type: 'text', text } : null;
}

function getOwnerJid(sock) {
  const raw = sock?.user?.id;
  if (!raw) return '';
  return jidNormalizedUser(raw);
}

function makeCaption(senderName, senderNumber, type, caption, time) {
  return [
    '╭─⌈ 📲 *STATUS DOWNLOADED* ⌋',
    `│ 👤 *From:* ${senderName ? `${senderName} (${senderNumber})` : senderNumber}`,
    caption ? `│ 💬 *Caption:* ${caption}` : '',
    `│ 📁 *Type:* ${type}`,
    `│ ⏰ *Time:* ${time}`,
    `╰⊷ ${FOOTER}`
  ].filter(Boolean).join('\n');
}

async function handleAutoDownloadStatus(sock, statusKey, resolvedMessage) {
  try {
    if (!manager.config.enabled || !resolvedMessage || statusKey?.fromMe) return false;
    const id = statusKey?.id;
    if (!id || manager.downloadedIds.has(id) || manager.excluded(statusKey)) return false;

    const content = normalizeMessageContent(resolvedMessage) || resolvedMessage;
    if (!content || content.protocolMessage || content.reactionMessage || content.messageStubType) return false;
    const media = getMediaInfo(content);
    const text = getTextInfo(content);
    const type = media?.type || 'text';
    if ((!media && !text) || !manager.config.downloadTypes.includes(type)) return false;

    const senderJid = statusKey.participantPn || statusKey.remoteJidAlt ||
      statusKey.participant || statusKey.remoteJid || '';
    const ownerNumber = manager.number(manager.config.ownerJid || getOwnerJid(sock));
    if (manager.config.skipOwnerStatus && ownerNumber && manager.number(senderJid) === ownerNumber) return false;

    const destination = manager.config.mode === 'private'
      ? (manager.config.ownerJid || getOwnerJid(sock))
      : manager.config.publicJid;
    if (!destination) return false;

    manager.mark(id);
    const senderNumber = getRealNumber(senderJid);
    const caption = makeCaption(
      statusKey.pushName || '',
      senderNumber,
      type,
      media?.caption,
      new Date().toLocaleTimeString()
    );

    if (media) {
      const cleanMedia = { ...media.media };
      delete cleanMedia.viewOnce;
      const downloadMessage = {
        key: { remoteJid: 'status@broadcast', id, participant: senderJid, fromMe: false },
        message: { [`${type}Message`]: cleanMedia }
      };
      const buffer = await Promise.race([
        downloadMediaMessage(downloadMessage, 'buffer', {}, {
          logger: { level: 'silent', child: () => ({}) },
          reuploadRequest: sock.updateMediaMessage
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('status download timeout')), 20000))
      ]);
      if (!buffer?.length) return false;

      const payload = {};
      if (type === 'sticker') {
        payload.sticker = buffer;
      } else if (type === 'document') {
        payload.document = buffer;
        payload.fileName = media.media.fileName || `status_${id}.bin`;
        payload.mimetype = media.media.mimetype || 'application/octet-stream';
        payload.caption = caption;
      } else {
        payload[type] = buffer;
        payload.caption = caption;
        if (media.media.mimetype) payload.mimetype = media.media.mimetype;
      }
      await sock.sendMessage(jidNormalizedUser(destination), payload);
      if (type === 'sticker') await sock.sendMessage(jidNormalizedUser(destination), { text: caption });
    } else {
      await sock.sendMessage(jidNormalizedUser(destination), {
        text: [
          '╭─⌈ 📲 *STATUS DOWNLOADED* ⌋',
          `│ 👤 *From:* ${statusKey.pushName ? `${statusKey.pushName} (${senderNumber})` : senderNumber}`,
          `│ 📝 *Text:* ${text.text}`,
          `│ ⏰ *Time:* ${new Date().toLocaleTimeString()}`,
          `╰⊷ ${FOOTER}`
        ].join('\n')
      });
    }
    manager.addLog(senderNumber, type);
    console.log(`[AutoDL-Status] ${type} from ${senderNumber}`);
    return true;
  } catch (error) {
    if (!/timeout|not-authorized/i.test(error.message || '')) {
      console.error('[AutoDL-Status]', error.message);
    }
    return false;
  }
}

function reply(sock, jid, msg, text) {
  return sock.sendMessage(jid, { text }, { quoted: msg });
}

async function execute(sock, msg, args, extra = {}) {
  const chatId = extra.from || msg.key.remoteJid;
  if (!extra.isOwner && !extra.isSudo) {
    return reply(sock, chatId, msg, '❌ Owner only command.');
  }
  const sub = String(args[0] || '').toLowerCase();
  const action = String(args[1] || '').toLowerCase();
  const caller = jidNormalizedUser(msg.key.participant || chatId);
  if (!manager.config.ownerJid) {
    manager.config.ownerJid = caller;
    manager.save();
  }

  if (!sub) {
    const c = manager.config;
    return reply(sock, chatId, msg,
      `╭─⌈ 📲 *AUTO-DOWNLOAD STATUS* ⌋\n│\n` +
      `│ Status: ${c.enabled ? '✅ ON' : '❌ OFF'}\n` +
      `│ Mode: ${c.mode === 'private' ? '🔒 Private DM' : `🌐 Public (${c.publicJid || 'not set'})`}\n` +
      `│ Types: ${c.downloadTypes.join(', ')}\n│ Total: ${c.totalDownloaded || 0} downloaded\n` +
      `│ Skip own status: ${c.skipOwnerStatus ? '✅' : '❌'}\n│\n` +
      `├─⊷ ${extra.prefix || '.'}ads on/off\n├─⊷ ${extra.prefix || '.'}ads private\n` +
      `├─⊷ ${extra.prefix || '.'}ads public <jid> | here\n├─⊷ ${extra.prefix || '.'}ads types [add/remove/all/reset] <type>\n` +
      `├─⊷ ${extra.prefix || '.'}ads exclude/include <number>\n├─⊷ ${extra.prefix || '.'}ads skipown on/off\n` +
      `├─⊷ ${extra.prefix || '.'}ads stats\n╰⊷ ${FOOTER}`
    );
  }
  if (['on', 'enable'].includes(sub)) {
    manager.config.enabled = true; manager.save();
    return reply(sock, chatId, msg, '✅ *AUTO-DOWNLOAD STATUS ENABLED*');
  }
  if (['off', 'disable'].includes(sub)) {
    manager.config.enabled = false; manager.save();
    return reply(sock, chatId, msg, '❌ *AUTO-DOWNLOAD STATUS DISABLED*');
  }
  if (sub === 'private') {
    manager.config.mode = 'private'; manager.config.ownerJid = caller; manager.save();
    return reply(sock, chatId, msg, '🔒 *PRIVATE MODE* — statuses will be saved to your DM.');
  }
  if (sub === 'public') {
    if (action === 'here') {
      manager.config.mode = 'public'; manager.config.publicJid = chatId; manager.save();
      return reply(sock, chatId, msg, '🌐 *PUBLIC MODE* — statuses will be forwarded here.');
    }
    if (!action || (!action.endsWith('@g.us') && !action.endsWith('@s.whatsapp.net'))) {
      return reply(sock, chatId, msg, `Usage: ${extra.prefix || '.'}ads public <groupJid>`);
    }
    manager.config.mode = 'public'; manager.config.publicJid = action; manager.save();
    return reply(sock, chatId, msg, `🌐 *PUBLIC MODE* — forwarding to ${action}`);
  }
  if (sub === 'here') {
    manager.config.mode = 'public'; manager.config.publicJid = chatId; manager.save();
    return reply(sock, chatId, msg, '🌐 *PUBLIC MODE* — statuses will be forwarded here.');
  }
  if (['exclude', 'skip', 'block'].includes(sub)) {
    const number = manager.number(args[1]);
    if (!number) return reply(sock, chatId, msg, `Usage: ${extra.prefix || '.'}ads exclude <number>`);
    if (!manager.config.excludedContacts.includes(number)) {
      manager.config.excludedContacts.push(number); manager.save();
      return reply(sock, chatId, msg, `✅ ${number} excluded.`);
    }
    return reply(sock, chatId, msg, '⚠️ That contact is already excluded.');
  }
  if (['include', 'unexclude', 'unblock'].includes(sub)) {
    const number = manager.number(args[1]);
    const index = manager.config.excludedContacts.indexOf(number);
    if (index === -1) return reply(sock, chatId, msg, '⚠️ That contact is not excluded.');
    manager.config.excludedContacts.splice(index, 1); manager.save();
    return reply(sock, chatId, msg, `✅ ${number} removed from exclusions.`);
  }
  if (sub === 'types') {
    if (!action) return reply(sock, chatId, msg, `Active types: ${manager.config.downloadTypes.join(', ')}\nUse ${extra.prefix || '.'}ads types add/remove/all/reset <type>`);
    if (action === 'all') manager.config.downloadTypes = [...ALL_TYPES];
    else if (action === 'reset') manager.config.downloadTypes = [...ALL_TYPES];
    else if (['add', 'remove'].includes(action)) {
      const type = String(args[2] || '').toLowerCase();
      if (!ALL_TYPES.includes(type)) return reply(sock, chatId, msg, `❌ Choose: ${ALL_TYPES.join(', ')}`);
      if (action === 'add' && !manager.config.downloadTypes.includes(type)) manager.config.downloadTypes.push(type);
      if (action === 'remove') manager.config.downloadTypes = manager.config.downloadTypes.filter(item => item !== type);
    } else return reply(sock, chatId, msg, `Usage: ${extra.prefix || '.'}ads types add/remove/all/reset <type>`);
    manager.save();
    return reply(sock, chatId, msg, `✅ Active types: ${manager.config.downloadTypes.join(', ')}`);
  }
  if (sub === 'skipown') {
    if (!['on', 'off'].includes(action)) return reply(sock, chatId, msg, `Skip own status: ${manager.config.skipOwnerStatus ? 'ON' : 'OFF'}`);
    manager.config.skipOwnerStatus = action === 'on'; manager.save();
    return reply(sock, chatId, msg, `✅ Skip own status: ${manager.config.skipOwnerStatus ? 'ON' : 'OFF'}`);
  }
  if (['stats', 'status', 'info'].includes(sub)) {
    const c = manager.config;
    return reply(sock, chatId, msg, `📊 *AUTO-DOWNLOAD STATUS STATS*\n\nStatus: ${c.enabled ? 'ACTIVE ✅' : 'INACTIVE ❌'}\nMode: ${c.mode}\nTypes: ${c.downloadTypes.join(', ')}\nTotal: ${c.totalDownloaded || 0}\nExcluded: ${c.excludedContacts.length}`);
  }
  if (['clear', 'reset'].includes(sub)) {
    manager.config.totalDownloaded = 0; manager.config.logs = []; manager.downloadedIds.clear(); manager.save();
    return reply(sock, chatId, msg, '🔄 Download history cleared.');
  }
  return reply(sock, chatId, msg, `❌ Unknown option. Use ${extra.prefix || '.'}ads for help.`);
}

module.exports = {
  name: 'autodownloadstatus',
  aliases: ['ads', 'autosave', 'autostatussave', 'autodlstatus'],
  category: 'automation',
  description: 'Automatically download WhatsApp statuses',
  usage: '.ads on|off|private|public <jid>|stats',
  ownerOnly: true,
  execute,
  handleAutoDownloadStatus,
  manager
};