/**
 * Message Handler - Processes incoming messages and executes commands
 */

const config = require('./config');
const database = require('./database');
const { loadCommands } = require('./utils/commandLoader');
const { addMessage, getActiveUsers, getInactiveUsers } = require('./utils/groupstats');
const { jidDecode, jidEncode, downloadMediaMessage } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Group metadata cache to prevent rate limiting
const groupMetadataCache = new Map();
const CACHE_TTL = 300000; // 5 minute cache (was 1 min)

// ─── View-Once Message Store ─────────────────────────────────────────────────
// Keyed by message ID, auto-purged after 30 minutes.
// Stores BOTH genuine view-once messages AND any image/video message so that
// a reaction on ANY media message can reveal it.
const viewOnceStore = new Map();
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, entry] of viewOnceStore) {
    if (entry.ts < cutoff) viewOnceStore.delete(id);
  }
}, 10 * 60 * 1000);

// Bot-admin status cache — avoids live API call on every message
const botAdminCache = new Map();
const BOT_ADMIN_TTL = 120000; // 2 minutes

// Settings caches — avoids disk reads on every message
let _arSettingsCache   = null;
let _arSettingsExpiry  = 0;
let _autoReadCache     = null;
let _autoReadExpiry    = 0;
const SETTINGS_CACHE_TTL = 8000; // 8 seconds

function getCachedArSettings() {
  if (_arSettingsCache && Date.now() < _arSettingsExpiry) return _arSettingsCache;
  try {
    _arSettingsCache = require('./utils/autoReact').load();
  } catch { _arSettingsCache = { enabled: false, mode: 'bot' }; }
  _arSettingsExpiry = Date.now() + SETTINGS_CACHE_TTL;
  return _arSettingsCache;
}

function getCachedAutoRead() {
  if (_autoReadCache && Date.now() < _autoReadExpiry) return _autoReadCache;
  try {
    const fs   = require('fs');
    const path = require('path');
    _autoReadCache = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/autoread.json'), 'utf8'));
  } catch { _autoReadCache = { mode: 'off' }; }
  _autoReadExpiry = Date.now() + SETTINGS_CACHE_TTL;
  return _autoReadCache;
}

// Invalidate settings caches when commands change them (called by set commands)
global.invalidateSettingsCache = () => {
  _arSettingsCache  = null;
  _autoReadCache    = null;
  botAdminCache.clear();
};

// Load all commands
const commands = loadCommands();

// Unwrap WhatsApp containers (ephemeral, view once, etc.)
const getMessageContent = (msg) => {
  if (!msg || !msg.message) return null;
  
  let m = msg.message;
  
  // Common wrappers in modern WhatsApp
  if (m.ephemeralMessage) m = m.ephemeralMessage.message;
  if (m.viewOnceMessageV2) m = m.viewOnceMessageV2.message;
  if (m.viewOnceMessage) m = m.viewOnceMessage.message;
  if (m.documentWithCaptionMessage) m = m.documentWithCaptionMessage.message;
  
  return m;
};

// Cached group metadata getter with rate limit handling (for non-admin checks)
const getCachedGroupMetadata = async (sock, groupId) => {
  try {
    if (!groupId || !groupId.endsWith('@g.us')) return null;
    
    const cached = groupMetadataCache.get(groupId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) return cached.data;
    
    const metadata = await sock.groupMetadata(groupId);
    groupMetadataCache.set(groupId, { data: metadata, timestamp: Date.now() });
    return metadata;
  } catch (error) {
    if (error.message && (
      error.message.includes('forbidden') || 
      error.message.includes('403') ||
      error.statusCode === 403 ||
      error.output?.statusCode === 403 ||
      error.data === 403
    )) {
      groupMetadataCache.set(groupId, { data: null, timestamp: Date.now() });
      return null;
    }
    if (error.message && error.message.includes('rate-overlimit')) {
      const cached = groupMetadataCache.get(groupId);
      if (cached) return cached.data;
      return null;
    }
    const cached = groupMetadataCache.get(groupId);
    if (cached) return cached.data;
    return null;
  }
};

// Live group metadata getter (always fresh, no cache) - for admin checks
const getLiveGroupMetadata = async (sock, groupId) => {
  try {
    const metadata = await sock.groupMetadata(groupId);
    groupMetadataCache.set(groupId, { data: metadata, timestamp: Date.now() });
    return metadata;
  } catch (error) {
    const cached = groupMetadataCache.get(groupId);
    if (cached) return cached.data;
    return null;
  }
};

const getGroupMetadata = getCachedGroupMetadata;

// Helper functions
const isOwner = (sender) => {
  if (!sender) return false;
  const rawNum = sender.split('@')[0].split(':')[0];
  if (config.ownerNumber.some(o => o.replace(/\D/g, '') === rawNum)) return true;
  try {
    const normalizedSender = normalizeJidWithLid(sender);
    const senderNumber = normalizeJid(normalizedSender);
    if (senderNumber && config.ownerNumber.some(owner => {
      const normalizedOwner = normalizeJidWithLid(owner.includes('@') ? owner : `${owner}@s.whatsapp.net`);
      const ownerNumber = normalizeJid(normalizedOwner);
      return ownerNumber === senderNumber;
    })) return true;
  } catch (_) {}
  return false;
};

const isSudo = (sender) => {
  if (!sender) return false;
  const number = sender.split('@')[0].split(':')[0];
  return database.isModerator(number);
};

const isMod = isSudo;

const lidMappingCache = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of groupMetadataCache) {
    if (now - val.timestamp > 10 * 60 * 1000) groupMetadataCache.delete(key);
  }
  lidMappingCache.clear();
}, 10 * 60 * 1000);

const normalizeJid = (jid) => {
  if (!jid) return null;
  if (typeof jid !== 'string') return null;
  if (jid.includes(':')) return jid.split(':')[0];
  if (jid.includes('@')) return jid.split('@')[0];
  return jid;
};

const getLidMappingValue = (user, direction) => {
  if (!user) return null;
  const cacheKey = `${direction}:${user}`;
  if (lidMappingCache.has(cacheKey)) return lidMappingCache.get(cacheKey);
  const sessionPath = path.join(__dirname, config.sessionName || 'session');
  const suffix = direction === 'pnToLid' ? '.json' : '_reverse.json';
  const filePath = path.join(sessionPath, `lid-mapping-${user}${suffix}`);
  if (!fs.existsSync(filePath)) {
    lidMappingCache.set(cacheKey, null);
    return null;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    const value = raw ? JSON.parse(raw) : null;
    lidMappingCache.set(cacheKey, value || null);
    return value || null;
  } catch (error) {
    lidMappingCache.set(cacheKey, null);
    return null;
  }
};

const normalizeJidWithLid = (jid) => {
  if (!jid) return jid;
  try {
    const decoded = jidDecode(jid);
    if (!decoded?.user) return `${jid.split(':')[0].split('@')[0]}@s.whatsapp.net`;
    let user = decoded.user;
    let server = decoded.server === 'c.us' ? 's.whatsapp.net' : decoded.server;
    const mapToPn = () => {
      const pnUser = getLidMappingValue(user, 'lidToPn');
      if (pnUser) {
        user = pnUser;
        server = server === 'hosted.lid' ? 'hosted' : 's.whatsapp.net';
        return true;
      }
      return false;
    };
    if (server === 'lid' || server === 'hosted.lid') mapToPn();
    else if (server === 's.whatsapp.net' || server === 'hosted') mapToPn();
    if (server === 'hosted') return jidEncode(user, 'hosted');
    return jidEncode(user, 's.whatsapp.net');
  } catch (error) {
    return jid;
  }
};

const buildComparableIds = (jid) => {
  if (!jid) return [];
  try {
    const decoded = jidDecode(jid);
    if (!decoded?.user) return [normalizeJidWithLid(jid)].filter(Boolean);
    const variants = new Set();
    const normalizedServer = decoded.server === 'c.us' ? 's.whatsapp.net' : decoded.server;
    variants.add(jidEncode(decoded.user, normalizedServer));
    const isPnServer = normalizedServer === 's.whatsapp.net' || normalizedServer === 'hosted';
    const isLidServer = normalizedServer === 'lid' || normalizedServer === 'hosted.lid';
    if (isPnServer) {
      const lidUser = getLidMappingValue(decoded.user, 'pnToLid');
      if (lidUser) {
        const lidServer = normalizedServer === 'hosted' ? 'hosted.lid' : 'lid';
        variants.add(jidEncode(lidUser, lidServer));
      }
    } else if (isLidServer) {
      const pnUser = getLidMappingValue(decoded.user, 'lidToPn');
      if (pnUser) {
        const pnServer = normalizedServer === 'hosted.lid' ? 'hosted' : 's.whatsapp.net';
        variants.add(jidEncode(pnUser, pnServer));
      }
    }
    return Array.from(variants);
  } catch (error) {
    return [jid];
  }
};

const findParticipant = (participants = [], userIds) => {
  const targets = (Array.isArray(userIds) ? userIds : [userIds])
    .filter(Boolean)
    .flatMap(id => buildComparableIds(id));
  if (!targets.length) return null;
  return participants.find(participant => {
    if (!participant) return false;
    const participantIds = [participant.id, participant.lid, participant.userJid]
      .filter(Boolean)
      .flatMap(id => buildComparableIds(id));
    return participantIds.some(id => targets.includes(id));
  }) || null;
};

const isAdmin = async (sock, participant, groupId, groupMetadata = null) => {
  if (!participant) return false;
  if (!groupId || !groupId.endsWith('@g.us')) return false;
  let liveMetadata = groupMetadata;
  if (!liveMetadata || !liveMetadata.participants) {
    if (groupId) liveMetadata = await getLiveGroupMetadata(sock, groupId);
    else return false;
  }
  if (!liveMetadata || !liveMetadata.participants) return false;
  const foundParticipant = findParticipant(liveMetadata.participants, participant);
  if (!foundParticipant) return false;
  return foundParticipant.admin === 'admin' || foundParticipant.admin === 'superadmin';
};

const isBotAdmin = async (sock, groupId, groupMetadata = null) => {
  if (!sock.user || !groupId) return false;
  if (!groupId.endsWith('@g.us')) return false;
  const cached = botAdminCache.get(groupId);
  if (cached && Date.now() - cached.ts < BOT_ADMIN_TTL) return cached.isAdmin;
  try {
    const botId  = sock.user.id;
    const botLid = sock.user.lid;
    if (!botId) return false;
    const botJids = [botId];
    if (botLid) botJids.push(botLid);
    const liveMetadata = await getLiveGroupMetadata(sock, groupId);
    if (!liveMetadata || !liveMetadata.participants) return false;
    const participant = findParticipant(liveMetadata.participants, botJids);
    const isAdmin = !!(participant && (participant.admin === 'admin' || participant.admin === 'superadmin'));
    botAdminCache.set(groupId, { isAdmin, ts: Date.now() });
    return isAdmin;
  } catch {
    return false;
  }
};

const isUrl = (text) => /(https?:\/\/[^\s]+)/gi.test(text);

const hasGroupLink = (text) => /chat.whatsapp.com\/([0-9A-Za-z]{20,24})/i.test(text);

const isSystemJid = (jid) => {
  if (!jid) return true;
  return jid.includes('@broadcast') || 
         jid.includes('status.broadcast') || 
         jid.includes('@newsletter') ||
         jid.includes('@newsletter.');
};

// ─── View-Once Store Helper ───────────────────────────────────────────────────
// Attempts to store any media message (genuine view-once OR plain image/video)
// into viewOnceStore so reactions can later reveal the media.
//
// Priority order for extraction:
//   1. viewOnceMessageV2 / viewOnceMessageV2Extension  (true view-once, Baileys v7)
//   2. viewOnceMessage                                  (legacy view-once)
//   3. Plain imageMessage / videoMessage                (non-view-once media)
//
// The rawMsg stored always has its media sitting directly under .message so that
// downloadMediaMessage() can find it without extra unwrapping.
const tryStoreViewOnce = (msg) => {
  try {
    if (!msg?.message) return;

    // Helper: build synthetic WAMessage with media at top level of .message
    const makeEntry = (innerMsg, isViewOnce = false) => {
      const voType =
        innerMsg.imageMessage ? 'image' :
        innerMsg.videoMessage ? 'video' : null;
      if (!voType) return;

      viewOnceStore.set(msg.key.id, {
        type:       voType,
        isViewOnce, // flag so we know if it was genuinely hidden
        rawMsg: {
          key:              msg.key,
          message:          innerMsg,     // { imageMessage:{…} } or { videoMessage:{…} }
          messageTimestamp: msg.messageTimestamp,
        },
        from:    msg.key.remoteJid,
        sender:  msg.key.participant || msg.key.remoteJid,
        caption:
          innerMsg.imageMessage?.caption ||
          innerMsg.videoMessage?.caption || '',
        ts: Date.now(),
      });
    };

    const m = msg.message;

    // 1. True view-once wrappers (Baileys v7)
    const voWrapper =
      m.viewOnceMessageV2 ||
      m.viewOnceMessageV2Extension ||
      m.viewOnceMessage;

    if (voWrapper?.message) {
      makeEntry(voWrapper.message, true);
      return;
    }

    // 2. Ephemeral wrapper that contains view-once inside
    const ephInner = m.ephemeralMessage?.message;
    if (ephInner) {
      const innerVo =
        ephInner.viewOnceMessageV2 ||
        ephInner.viewOnceMessageV2Extension ||
        ephInner.viewOnceMessage;
      if (innerVo?.message) {
        makeEntry(innerVo.message, true);
        return;
      }
      // Ephemeral plain image/video — store it too
      if (ephInner.imageMessage || ephInner.videoMessage) {
        makeEntry(ephInner, false);
        return;
      }
    }

    // 3. Plain image / video at the top level (non-view-once)
    if (m.imageMessage || m.videoMessage) {
      makeEntry(m, false);
    }
  } catch (_) {}
};

// ─── View-Once Reveal via Reaction ───────────────────────────────────────────
// Called when msg.message.reactionMessage is detected.
// Looks up the reacted-to message ID in viewOnceStore and forwards the media
// to the reactor's DM and the bot's own inbox.
const handleViewOnceReveal = async (sock, msg) => {
  const reaction   = msg.message.reactionMessage;
  const emoji      = reaction?.text || '';
  const reactedId  = reaction?.key?.id;
  const chatJid    = msg.key.remoteJid;
  const reactorJid = msg.key.participant || msg.key.remoteJid;

  // ── 1. View-once (or any media) reveal ────────────────────────────────────
  // Only trigger on a real emoji tap, not on emoji removal (empty string)
  if (emoji && reactedId) {
    try {
      const stored = viewOnceStore.get(reactedId);

      if (stored) {
        const reactorNum = reactorJid.replace(/@.+$/, '');
        const dmJid      = reactorNum + '@s.whatsapp.net';
        const senderNum  = stored.sender.replace(/@.+$/, '');
        const fromLabel  = stored.from.endsWith('@g.us') ? 'group' : 'DM';
        const botJid     = (sock.user?.id || '').replace(/:\d+@/, '@');

        const caption    = stored.caption ? `\n📝 *Caption:* ${stored.caption}` : '';
        const typeLabel  = stored.isViewOnce ? '👁 *View-Once Revealed*' : '🖼 *Media Revealed*';

        const infoText =
          `${typeLabel}\n` +
          `${'━'.repeat(22)}\n` +
          `📍 *Sent by:* @${senderNum}\n` +
          `📍 *From:* ${fromLabel}\n` +
          `👤 *Reactor:* @${reactorNum}\n` +
          `🔓 *Reacted with:* ${emoji}` +
          caption;

        // Download once, send to both destinations
        const mediaBuf = await downloadMediaMessage(stored.rawMsg, 'buffer', {});

        const sendTo = async (jid) => {
          await sock.sendMessage(jid, {
            text: infoText,
            mentions: [stored.sender, reactorJid],
          });
          if (stored.type === 'image') {
            await sock.sendMessage(jid, {
              image:   mediaBuf,
              caption: stored.caption,
            });
          } else if (stored.type === 'video') {
            await sock.sendMessage(jid, {
              video:   mediaBuf,
              caption: stored.caption,
            });
          }
        };

        // Send to reactor's personal DM
        await sendTo(dmJid);

        // Also send to bot's own inbox (if different from reactor)
        if (botJid && botJid !== dmJid) await sendTo(botJid);
      }
    } catch (e) {
      console.error('[ViewOnce Reveal]', e.message);
    }
  }

  // ── 2. Bot reacts back with a random emoji ────────────────────────────────
  if (emoji && !msg.key.fromMe) {
    try {
      const replyEmojis = ['❤️','🔥','😂','👏','🎉','💯','✨','😍','🤩','💪','👌','🙌'];
      const pick = replyEmojis[Math.floor(Math.random() * replyEmojis.length)];
      await sock.sendMessage(chatJid, {
        react: { text: pick, key: msg.key },
      });
    } catch (e) {
      console.error('[Reaction Reply]', e.message);
    }
  }
};

// Main message handler
const handleMessage = async (sock, msg) => {
  try {
    if (!msg.message) return;

    // Store message for antidelete and antiedit
    try {
      const antidelete = commands.get('antidelete');
      if (antidelete?.storeMessage) antidelete.storeMessage(msg);
    } catch (_) {}
    try {
      const antiedit = commands.get('antiedit');
      if (antiedit?.storeMessage) antiedit.storeMessage(msg);
    } catch (_) {}

    // ── Store ALL media messages for reaction-triggered reveal ───────────────
    // This runs on every message (before the reaction check) so the store is
    // always populated before any reaction arrives.
    tryStoreViewOnce(msg);
    // ─────────────────────────────────────────────────────────────────────────

    // ── Reaction message: reveal media + react back, then exit ───────────────
    if (msg.message?.reactionMessage) {
      await handleViewOnceReveal(sock, msg);
      return; // reactions don't need command processing
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Store status messages for antideletestatus (must run before isSystemJid filter)
    try {
      if (msg.key.remoteJid === 'status@broadcast') {
        const antideletestatus = commands.get('antideletestatus');
        if (antideletestatus?.storeStatusMessage) antideletestatus.storeStatusMessage(msg);
        return;
      }
    } catch (_) {}

    const from = msg.key.remoteJid;
    
    // System message filter
    if (isSystemJid(from)) return;
    
    // Auto-React System
    try {
      const arSettings = getCachedArSettings();
      if (arSettings.enabled && msg.message && !msg.key.fromMe) {
        const content = msg.message.ephemeralMessage?.message || msg.message;
        const text =
          content.conversation ||
          content.extendedTextMessage?.text || '';
        const jid  = msg.key.remoteJid;
        const mode = arSettings.mode || 'bot';
        const emojis = ['❤️','🔥','👌','💀','😁','✨','👍','🤨','😎','😂','🤝','💫'];
        if (mode === 'bot') {
          const prefixList = ['.', '/', '#'];
          if (prefixList.includes(text?.trim()[0])) {
            await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } });
          }
        }
        if (mode === 'all') {
          const rand = emojis[Math.floor(Math.random() * emojis.length)];
          await sock.sendMessage(jid, { react: { text: rand, key: msg.key } });
        }
      }
    } catch (e) {
      console.error('[AutoReact Error]', e.message);
    }
    
    // Unwrap containers
    const content = getMessageContent(msg);
    
    let actualMessageTypes = [];
    if (content) {
      const allKeys = Object.keys(content);
      const protocolMessages = ['protocolMessage', 'senderKeyDistributionMessage', 'messageContextInfo'];
      actualMessageTypes = allKeys.filter(key => !protocolMessages.includes(key));
    }
    
    const messageType = actualMessageTypes[0];
    
    const sender = msg.key.fromMe
      ? sock.user.id.split(':')[0] + '@s.whatsapp.net'
      : msg.key.participant || msg.key.remoteJid;
    const isGroup = from.endsWith('@g.us');

    // Presence
    if (!msg.key.fromMe) {
      try {
        const { getMode } = require('./utils/presenceSettings');
        const _pm = getMode();
        if (_pm === 'recording' || _pm === 'recordtype') {
          sock.sendPresenceUpdate('recording', from).catch(() => {});
        } else if (_pm === 'typing') {
          sock.sendPresenceUpdate('composing', from).catch(() => {});
        }
      } catch (_pErr) {}
    }

    // Auto Read
    if (!msg.key.fromMe) {
      try {
        const arData = getCachedAutoRead();
        const arMode = arData.mode || 'off';
        if (
          arMode === 'on' ||
          (arMode === 'pm'    && !isGroup) ||
          (arMode === 'group' &&  isGroup)
        ) {
          await sock.readMessages([msg.key]);
        }
      } catch (_arErr) {}
    }

    const groupMetadata = isGroup ? await getGroupMetadata(sock, from) : null;
    
    // Muted-user enforcement
    if (isGroup && !msg.key.fromMe && sender) {
      try {
        if (database.isUserMuted(from, sender)) {
          await sock.sendMessage(from, { delete: msg.key });
          return;
        }
      } catch (_muteErr) {}
    }

    // Anti-* protection
    if (isGroup) {
      const antispam     = commands.get('antispam');
      const antiviewonce = commands.get('antiviewonce');
      const antibot      = commands.get('antibot');
      await Promise.allSettled([
        handleAntigroupmention(sock, msg, groupMetadata),
        handleAntigroupstatus(sock, msg, groupMetadata),
        handleAntiMedia(sock, msg, groupMetadata),
        antispam?.handleAntispam         ? antispam.handleAntispam(sock, msg, groupMetadata)         : Promise.resolve(),
        antiviewonce?.handleAntiviewonce ? antiviewonce.handleAntiviewonce(sock, msg)                : Promise.resolve(),
        antibot?.handleMessage           ? antibot.handleMessage(sock, msg, groupMetadata)           : Promise.resolve(),
        handleAntibadword(sock, msg, groupMetadata),
      ]);
    }
    
    // Track group message statistics
    if (isGroup) addMessage(from, sender);
    
    // Return early for non-group messages with no recognizable content
    if (!content || actualMessageTypes.length === 0) return;
    
    // Button response handling
    const _btnResp = content.buttonsResponseMessage || msg.message?.buttonsResponseMessage;
    const _tplResp = content.templateButtonReplyMessage || msg.message?.templateButtonReplyMessage;
    const btn = _btnResp || _tplResp || null;
    if (btn) {
      const buttonId = _btnResp ? btn.selectedButtonId : btn.selectedId;

      const makeExtra = async () => ({
        from,
        sender,
        isGroup,
        groupMetadata,
        isOwner: isOwner(sender),
        isAdmin: await isAdmin(sock, sender, from, groupMetadata),
        isBotAdmin: await isBotAdmin(sock, from, groupMetadata),
        isMod: isMod(sender),
        isSudo: isMod(sender),
        prefix: config.prefix || '.',
        command: '',
        reply: (text) => sock.sendMessage(from, { text }, { quoted: msg }),
        react: (emoji) => sock.sendMessage(from, { react: { text: emoji, key: msg.key } })
      });

      if (buttonId === 'btn_menu') {
        const extra = await makeExtra();
        const menuCmd = commands.get('menu');
        if (menuCmd) await menuCmd.execute(sock, msg, [], extra);
        return;
      } else if (buttonId === 'menu_repo') {
        const repoUrl = config.social?.github || 'https://github.com/Vinpink2/June-Ultra';
        await sock.sendMessage(from, { text: `💻 *Bot Repository*\n${repoUrl}` }, { quoted: msg });
        return;
      } else if (buttonId === 'menu_yt') {
        const ytUrl = config.social?.youtube || 'http://youtube.com/@suprem_e_lord';
        await sock.sendMessage(from, { text: `📺 *YouTube Channel*\n${ytUrl}` }, { quoted: msg });
        return;
      } else if (buttonId === 'btn_ping') {
        const extra = await makeExtra();
        const pingCmd = commands.get('ping');
        if (pingCmd) await pingCmd.execute(sock, msg, [], extra);
        return;
      } else if (buttonId === 'btn_help') {
        const extra = await makeExtra();
        const listCmd = commands.get('list');
        if (listCmd) await listCmd.execute(sock, msg, [], extra);
        return;
      }

      const cfgPrefix = config.prefix || '.';
      if (buttonId && buttonId.startsWith(cfgPrefix)) {
        const parts   = buttonId.slice(cfgPrefix.length).trim().split(/\s+/);
        const cmdName = parts[0].toLowerCase();
        const cmdArgs = parts.slice(1);
        const dynCmd  = commands.get(cmdName);
        if (dynCmd) {
          const extra = await makeExtra();
          extra.command = cmdName;
          extra.prefix  = cfgPrefix;
          await dynCmd.execute(sock, msg, cmdArgs, extra);
        }
        return;
      }
    }
    
    // Get message body
    let body = '';
    if (content.conversation) {
      body = content.conversation;
    } else if (content.extendedTextMessage) {
      body = content.extendedTextMessage.text || '';
    } else if (content.imageMessage) {
      body = content.imageMessage.caption || '';
    } else if (content.videoMessage) {
      body = content.videoMessage.caption || '';
    }
    body = (body || '').trim();
    
    // Check antiall protection
    if (isGroup) {
      const groupSettings = database.getGroupSettings(from);
      if (groupSettings.antiall) {
        const senderIsAdmin = await isAdmin(sock, sender, from, groupMetadata);
        const senderIsOwner = isOwner(sender);
        if (!senderIsAdmin && !senderIsOwner) {
          const botIsAdmin = await isBotAdmin(sock, from, groupMetadata);
          if (botIsAdmin) {
            await sock.sendMessage(from, { delete: msg.key });
            return;
          }
        }
      }
      
      if (groupSettings.antitag && !msg.key.fromMe) {
        const ctx = content.extendedTextMessage?.contextInfo;
        const mentionedJids = ctx?.mentionedJid || [];
        const messageText = (body || content.imageMessage?.caption || content.videoMessage?.caption || '');
        const numericMentions = messageText.match(/@\d{10,}/g) || [];
        const uniqueNumericMentions = new Set();
        numericMentions.forEach(mention => {
          const numMatch = mention.match(/@(\d+)/);
          if (numMatch) uniqueNumericMentions.add(numMatch[1]);
        });
        const mentionedJidCount = mentionedJids.length;
        const numericMentionCount = uniqueNumericMentions.size;
        const totalMentions = Math.max(mentionedJidCount, numericMentionCount);
        if (totalMentions >= 3) {
          try {
            const participants = groupMetadata.participants || [];
            const mentionThreshold = Math.max(3, Math.ceil(participants.length * 0.5));
            const hasManyNumericMentions = numericMentionCount >= 10 ||
              (numericMentionCount >= 5 && numericMentionCount >= mentionThreshold);
            if (totalMentions >= mentionThreshold || hasManyNumericMentions) {
              const senderIsAdmin = await isAdmin(sock, sender, from, groupMetadata);
              const senderIsOwner = isOwner(sender);
              if (!senderIsAdmin && !senderIsOwner) {
                const action = (groupSettings.antitagAction || 'delete').toLowerCase();
                if (action === 'delete') {
                  try {
                    await sock.sendMessage(from, { delete: msg.key });
                    await sock.sendMessage(from, { text: '⚠️ *Tagall Detected!*', mentions: [sender] }, { quoted: msg });
                  } catch (e) { console.error('Failed to delete tagall message:', e); }
                } else if (action === 'kick') {
                  try { await sock.sendMessage(from, { delete: msg.key }); } catch (e) { console.error('Failed to delete tagall message:', e); }
                  const botIsAdmin = await isBotAdmin(sock, from, groupMetadata);
                  if (botIsAdmin) {
                    try {
                      await sock.groupParticipantsUpdate(from, [sender], 'remove');
                    } catch (e) { console.error('Failed to kick for antitag:', e); }
                    await sock.sendMessage(from, {
                      text: `🚫 *Antitag Detected!*\n\n@${sender.split('@')[0]} has been kicked for tagging all members.`,
                      mentions: [sender],
                    }, { quoted: msg });
                  }
                }
                return;
              }
            }
          } catch (e) { console.error('Error during anti-tag enforcement:', e); }
        }
      }
    }
    
    // AutoSticker
    if (isGroup) {
      const groupSettings = database.getGroupSettings(from);
      if (groupSettings.autosticker) {
        const mediaMessage = content?.imageMessage || content?.videoMessage;
        if (mediaMessage && !body.startsWith(config.prefix)) {
          try {
            const stickerCmd = commands.get('sticker');
            if (stickerCmd) {
              await stickerCmd.execute(sock, msg, [], {
                from, sender, isGroup, groupMetadata,
                isOwner: isOwner(sender),
                isAdmin: await isAdmin(sock, sender, from, groupMetadata),
                isBotAdmin: await isBotAdmin(sock, from, groupMetadata),
                isMod: isMod(sender),
                reply: (text) => sock.sendMessage(from, { text }, { quoted: msg }),
                react: (emoji) => sock.sendMessage(from, { react: { text: emoji, key: msg.key } })
              });
              return;
            }
          } catch (error) { console.error('[AutoSticker Error]:', error); }
        }
      }
    }

    // Active bomb games
    try {
      const bombModule = require('./commands/fun/bomb');
      if (bombModule.gameState && bombModule.gameState.has(sender)) {
        const bombCommand = commands.get('bomb');
        if (bombCommand?.execute) {
          await bombCommand.execute(sock, msg, [], {
            from, sender, isGroup, groupMetadata,
            isOwner: isOwner(sender),
            isAdmin: await isAdmin(sock, sender, from, groupMetadata),
            isBotAdmin: await isBotAdmin(sock, from, groupMetadata),
            isMod: isMod(sender),
            reply: (text) => sock.sendMessage(from, { text }, { quoted: msg }),
            react: (emoji) => sock.sendMessage(from, { react: { text: emoji, key: msg.key } })
          });
          return;
        }
      }
    } catch (e) {}
    
    // Active tictactoe games
    try {
      const tictactoeModule = require('./commands/fun/tictactoe');
      if (tictactoeModule.handleTicTacToeMove) {
        const isInGame = Object.values(tictactoeModule.games || {}).some(room => 
          room.id.startsWith('tictactoe') && 
          [room.game.playerX, room.game.playerO].includes(sender) && 
          room.state === 'PLAYING'
        );
        if (isInGame) {
          const handled = await tictactoeModule.handleTicTacToeMove(sock, msg, {
            from, sender, isGroup, groupMetadata,
            isOwner: isOwner(sender),
            isAdmin: await isAdmin(sock, sender, from, groupMetadata),
            isBotAdmin: await isBotAdmin(sock, from, groupMetadata),
            isMod: isMod(sender),
            reply: (text) => sock.sendMessage(from, { text }, { quoted: msg }),
            react: (emoji) => sock.sendMessage(from, { react: { text: emoji, key: msg.key } })
          });
          if (handled) return;
        }
      }
    } catch (e) {}
    
    // Fancy text style selection
    if (/^\d+$/.test(body.trim())) {
      const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      const quotedText = quotedMsg?.conversation || quotedMsg?.extendedTextMessage?.text || '';
      if (quotedText.includes('Fancy Text Styles') || quotedText.includes('Fancy Styles for:')) {
        const fancyCmd = commands.get('fancy');
        if (fancyCmd) {
          return fancyCmd.execute(sock, msg, [body.trim()], {
            from, sender,
            reply: (text) => sock.sendMessage(from, { text }, { quoted: msg }),
            react: (emoji) => sock.sendMessage(from, { react: { text: emoji, key: msg.key } }),
          });
        }
      }
    }

    // My groups: reply to group list with a number
    if (/^\d+$/.test(body.trim())) {
      const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      const quotedText = quotedMsg?.conversation || quotedMsg?.extendedTextMessage?.text || '';
      if (quotedText.includes('📋') && quotedText.includes('Group List')) {
        const mygroupsCmd = commands.get('mygroups');
        if (mygroupsCmd) {
          return mygroupsCmd.execute(sock, msg, [body.trim()], {
            from, sender,
            command: 'mygroups',
            prefix: config.prefix,
            reply: (text) => sock.sendMessage(from, { text }, { quoted: msg }),
            react: (emoji) => sock.sendMessage(from, { react: { text: emoji, key: msg.key } }),
          });
        }
      }
    }

    // Chatbot auto-reply
    if (!body.startsWith(config.prefix)) {
      if (body.trim() && !msg.key.fromMe) {
        try {
          const chatbotCmd = commands.get('chatbot');
          if (chatbotCmd?.handleAutoReply) {
            await chatbotCmd.handleAutoReply(sock, msg, { from, isGroup });
          }
        } catch (e) {}
      }
      return;
    }

    // Parse command
    const args = body.slice(config.prefix.length).trim().split(/\s+/);
    const commandName = args.shift().toLowerCase();
    
    const command = commands.get(commandName);
    if (!command) return;
    
    // Resolve LID sender → phone number JID
    let resolvedSender = sender;
    if (isGroup && sender && groupMetadata?.participants) {
      const senderRaw = sender.split('@')[0];
      const looksLikeLid = sender.endsWith('@lid') || !/^\d{7,}$/.test(senderRaw);
      if (looksLikeLid) {
        const matched = groupMetadata.participants.find(p => {
          if (!p) return false;
          const pId  = typeof p === 'string' ? p : (p.id  || p.jid || '');
          const pLid = typeof p === 'string' ? '' : (p.lid || '');
          return pId === sender || pLid === sender;
        });
        if (matched && typeof matched === 'object') {
          const pn = matched.phoneNumber || matched.pn;
          if (pn) resolvedSender = pn.includes('@') ? pn : `${pn}@s.whatsapp.net`;
        }
      }
    }

    const senderIsOwner = msg.key.fromMe || isOwner(resolvedSender);
    const senderIsSudo  = senderIsOwner || isSudo(resolvedSender);

    // Bot mode check
    {
      const { getMode } = require('./utils/botMode');
      const botModeVal = getMode();
      if (botModeVal === 'private' && !senderIsSudo) return;
      if (botModeVal === 'group' && !isGroup && !senderIsSudo) return;
      if (botModeVal === 'pm' && isGroup && !senderIsSudo) return;
    }
    
    // Permission checks
    if (command.ownerOnly && !senderIsOwner && !senderIsSudo)
      return sock.sendMessage(from, { text: config.messages.ownerOnly }, { quoted: msg });
    if (command.modOnly && !senderIsSudo)
      return sock.sendMessage(from, { text: '🔒 This command is only for moderators!' }, { quoted: msg });
    if (command.groupOnly && !isGroup)
      return sock.sendMessage(from, { text: config.messages.groupOnly }, { quoted: msg });
    if (command.privateOnly && isGroup)
      return sock.sendMessage(from, { text: config.messages.privateOnly }, { quoted: msg });
    if (command.adminOnly && !(await isAdmin(sock, sender, from, groupMetadata)) && !senderIsOwner)
      return sock.sendMessage(from, { text: config.messages.adminOnly }, { quoted: msg });
    if (command.botAdminNeeded) {
      const botIsAdmin = await isBotAdmin(sock, from, groupMetadata);
      if (!botIsAdmin)
        return sock.sendMessage(from, { text: config.messages.botAdminNeeded }, { quoted: msg });
    }
    
    // Presence indicators
    try {
      const { getMode } = require('./utils/presenceSettings');
      const presenceMode = getMode();
      if (presenceMode === 'recordtype') {
        await sock.sendPresenceUpdate('recording', from);
        await new Promise(r => setTimeout(r, 1500));
        await sock.sendPresenceUpdate('composing', from);
        await new Promise(r => setTimeout(r, 800));
      } else if (presenceMode === 'recording') {
        await sock.sendPresenceUpdate('recording', from);
        await new Promise(r => setTimeout(r, 1000));
      } else if (presenceMode === 'typing') {
        await sock.sendPresenceUpdate('composing', from);
        await new Promise(r => setTimeout(r, 800));
      } else if (config.autoTyping) {
        await sock.sendPresenceUpdate('composing', from);
        await new Promise(r => setTimeout(r, 800));
      }
    } catch (presenceErr) {
      console.error('[PRESENCE] error:', presenceErr.message);
    }
    
    // Command execution log
    const chalk = require('chalk');
    const senderNum = sender.split('@')[0].split(':')[0];
    console.log(
      chalk.magenta.bold('[ CMD ]'),
      chalk.cyan(`✦ ${commandName}`),
      chalk.yellow(`← ${senderNum}`),
      senderIsOwner ? chalk.green('[OWNER]') : senderIsSudo ? chalk.blue('[SUDO]') : chalk.white('[USER]')
    );
    
    const { applyFont } = require('./utils/fontConverter');
    await command.execute(sock, msg, args, {
      from, sender, isGroup, groupMetadata,
      groupName: groupMetadata?.subject || null,
      isOwner: senderIsOwner,
      isAdmin: await isAdmin(sock, sender, from, groupMetadata),
      isBotAdmin: await isBotAdmin(sock, from, groupMetadata),
      isMod: senderIsSudo,
      isSudo: senderIsSudo,
      prefix: config.prefix,
      command: commandName,
      reply: (text) => sock.sendMessage(from, { text: applyFont(text) }, { quoted: msg }),
      react: (emoji) => sock.sendMessage(from, { react: { text: emoji, key: msg.key } }),
      getCommandCount: () => commands.size,
      getActiveUsers: (groupId, limit) => getActiveUsers(groupId, limit),
      getInactiveUsers: (groupId, participants) => getInactiveUsers(groupId, participants)
    });
    
  } catch (error) {
    console.error('Error in message handler:', error);
    if (error.message && error.message.includes('rate-overlimit')) {
      console.warn('⚠️ Rate limit reached. Skipping error message.');
      return;
    }
    try {
      await sock.sendMessage(msg.key.remoteJid, { 
        text: `${config.messages.error}\n\n${error.message}` 
      }, { quoted: msg });
    } catch (e) {
      if (!e.message || !e.message.includes('rate-overlimit')) {
        console.error('Error sending error message:', e);
      }
    }
  }
};

// Group participant update handler
const handleGroupUpdate = async (sock, update) => {
  try {
    const { id, participants, action, author: actor } = update;
    if (!id || !id.endsWith('@g.us')) return;

    if (action === 'demote' || action === 'promote') {
      try {
        const antidemoteCmd  = commands.get('antidemote');
        const antipromoteCmd = commands.get('antipromote');
        let resolvedActor = actor || null;
        if (resolvedActor) {
          try { resolvedActor = normalizeJidWithLid(resolvedActor) || resolvedActor; } catch (_) {}
        }
        for (const participant of participants) {
          let pJid = typeof participant === 'string'
            ? participant
            : (participant?.phoneNumber || participant?.pn || participant?.id || participant?.jid || null);
          if (!pJid) continue;
          if (action === 'demote' && antidemoteCmd?.handleDemote)
            await antidemoteCmd.handleDemote(sock, id, resolvedActor, pJid);
          if (action === 'promote' && antipromoteCmd?.handlePromote)
            await antipromoteCmd.handlePromote(sock, id, resolvedActor, pJid);
        }
      } catch (e) {
        console.error('[handleGroupUpdate] antidemote/antipromote error:', e.message);
      }
    }

    const groupSettings = database.getGroupSettings(id);
    if (!groupSettings.welcome && !groupSettings.goodbye) return;
    
    const groupMetadata = await getGroupMetadata(sock, id);
    if (!groupMetadata) return;
    
    const getParticipantJid = (participant) => {
      if (typeof participant === 'string') return participant;
      if (participant?.id) return participant.id;
      if (participant && typeof participant === 'object')
        return participant.jid || participant.participant || null;
      return null;
    };
    
    const buildMsg = (template, vars) => {
      return (template || '')
        .replace(/@user/g, `@${vars.number}`)
        .replace(/@group/g, vars.groupName)
        .replace(/groupDesc/g, vars.groupDesc)
        .replace(/time/g, vars.timeString)
        .replace(/#memberCount/g, String(vars.memberCount))
        .replace(/botName/g, config.botName);
    };

    const fetchPpBuffer = async (memberJid, groupJid) => {
      try {
        const url = await sock.profilePictureUrl(memberJid, 'image');
        const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 8000 });
        return Buffer.from(res.data);
      } catch (_) {}
      try {
        const url = await sock.profilePictureUrl(groupJid, 'image');
        const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 8000 });
        return Buffer.from(res.data);
      } catch (_) {}
      return null;
    };
    
    for (const participant of participants) {
      const participantJid = getParticipantJid(participant);
      if (!participantJid) continue;
      const participantNumber = participantJid.split('@')[0];
      
      if (action === 'add') {
        try {
          const antibot = commands.get('antibot');
          if (antibot?.handleGroupJoin) await antibot.handleGroupJoin(sock, id, participantJid);
        } catch (_) {}
        try {
          const antiforeign = commands.get('antiforeign');
          if (antiforeign?.handleGroupJoin) await antiforeign.handleGroupJoin(sock, id, participantJid);
        } catch (_) {}
      }

      if (action === 'add' && groupSettings.welcome) {
        try {
          const groupName   = groupMetadata.subject || 'the group';
          const groupDesc   = groupMetadata.desc || 'No description';
          const timeString  = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
          const memberCount = groupMetadata.participants.length;
          const msgText = buildMsg(groupSettings.welcomeMessage, { number: participantNumber, groupName, groupDesc, timeString, memberCount });
          const noPP = groupSettings.welcomeNoPP === true;
          if (noPP) {
            await sock.sendMessage(id, { text: msgText, mentions: [participantJid] });
          } else {
            const ppBuffer = await fetchPpBuffer(participantJid, id);
            if (ppBuffer) {
              await sock.sendMessage(id, { image: ppBuffer, caption: msgText, mentions: [participantJid] });
            } else {
              await sock.sendMessage(id, { text: msgText, mentions: [participantJid] });
            }
          }
        } catch (welcomeError) {
          console.error('Welcome error:', welcomeError);
          try {
            const fallback = (groupSettings.welcomeMessage || 'Welcome @user to @group! 👋')
              .replace(/@user/g, `@${participantNumber}`)
              .replace(/@group/g, groupMetadata.subject || 'the group');
            await sock.sendMessage(id, { text: fallback, mentions: [participantJid] });
          } catch (_) {}
        }
      } else if (action === 'remove' && groupSettings.goodbye) {
        try {
          const groupName   = groupMetadata.subject || 'the group';
          const groupDesc   = groupMetadata.desc || 'No description';
          const timeString  = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
          const memberCount = groupMetadata.participants.length;
          const msgText = buildMsg(groupSettings.goodbyeMessage, { number: participantNumber, groupName, groupDesc, timeString, memberCount });
          const noPP = groupSettings.welcomeNoPP === true;
          if (noPP) {
            await sock.sendMessage(id, { text: msgText, mentions: [participantJid] });
          } else {
            const ppBuffer = await fetchPpBuffer(participantJid, id);
            if (ppBuffer) {
              await sock.sendMessage(id, { image: ppBuffer, caption: msgText, mentions: [participantJid] });
            } else {
              await sock.sendMessage(id, { text: msgText, mentions: [participantJid] });
            }
          }
        } catch (goodbyeError) {
          console.error('Goodbye error:', goodbyeError);
          try {
            const fallback = (groupSettings.goodbyeMessage || 'Goodbye @user 👋')
              .replace(/@user/g, `@${participantNumber}`)
              .replace(/@group/g, groupMetadata.subject || 'the group');
            await sock.sendMessage(id, { text: fallback, mentions: [participantJid] });
          } catch (_) {}
        }
      }
    }
  } catch (error) {
    if (error.message && (
      error.message.includes('forbidden') || 
      error.message.includes('403') ||
      error.statusCode === 403 ||
      error.output?.statusCode === 403 ||
      error.data === 403
    )) return;
    if (!error.message || !error.message.includes('forbidden'))
      console.error('Error handling group update:', error);
  }
};

// Antilink handler
const handleAntilink = async (sock, msg, groupMetadata) => {
  try {
    const from   = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;
    const groupSettings = database.getGroupSettings(from);
    if (!groupSettings.antilink) return;
    const body = msg.message?.conversation || 
                 msg.message?.extendedTextMessage?.text || 
                 msg.message?.imageMessage?.caption || 
                 msg.message?.videoMessage?.caption || '';
    const linkPattern = /(https?:\/\/)?([a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]*\.)+[a-zA-Z]{2,}(\/[^\s]*)?/i;
    if (linkPattern.test(body)) {
      const senderIsAdmin = await isAdmin(sock, sender, from, groupMetadata);
      const senderIsOwner = isOwner(sender);
      if (senderIsAdmin || senderIsOwner) return;
      const botIsAdmin = await isBotAdmin(sock, from, groupMetadata);
      const action = (groupSettings.antilinkAction || 'delete').toLowerCase();
      const senderNum = sender.split('@')[0];
      if (action === 'warn' && botIsAdmin) {
        const warnData = database.addWarning(from, sender, 'Sent a link');
        const maxWarns = config.maxWarnings || 3;
        try { await sock.sendMessage(from, { delete: msg.key }); } catch (_) {}
        if (warnData.count >= maxWarns) {
          try {
            await sock.groupParticipantsUpdate(from, [sender], 'remove');
            await sock.sendMessage(from, {
              text: `🔗 @${senderNum} has been removed.\n⚠️ Reached ${maxWarns}/${maxWarns} warnings for sending links.`,
              mentions: [sender],
            });
            database.clearWarnings(from, sender);
          } catch (e) { console.error('Failed to kick after max warns (antilink):', e); }
        } else {
          await sock.sendMessage(from, {
            text: `🔗 @${senderNum} warned ⚠️\n\n📌 Reason: Sending links is not allowed\n⚠️ Warnings: ${warnData.count}/${maxWarns}\n\n_${maxWarns - warnData.count} more warning(s) before removal._`,
            mentions: [sender],
          });
        }
      } else if (action === 'kick' && botIsAdmin) {
        try {
          await sock.sendMessage(from, { delete: msg.key });
          await sock.groupParticipantsUpdate(from, [sender], 'remove');
          await sock.sendMessage(from, {
            text: `🔗 @${senderNum} has been removed for sending a link.`,
            mentions: [sender],
          });
        } catch (e) { console.error('Failed to kick for antilink:', e); }
      } else {
        try {
          await sock.sendMessage(from, { delete: msg.key });
          await sock.sendMessage(from, {
            text: `🔗 @${senderNum}'s message was deleted.\n📌 Reason: Links are not allowed in this group.`,
            mentions: [sender],
          });
        } catch (e) { console.error('Failed to delete for antilink:', e); }
      }
    }
  } catch (error) {
    console.error('Error in antilink handler:', error);
  }
};

// Anti-bad-word handler
const handleAntibadword = async (sock, msg, groupMetadata) => {
  try {
    const from   = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;
    const groupSettings = database.getGroupSettings(from);
    if (!groupSettings.antibadword) return;
    const badwords = database.getBadWords(from);
    if (!badwords.length) return;
    const body = (
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      msg.message?.videoMessage?.caption || ''
    ).toLowerCase();
    if (!body) return;
    const found = badwords.find(word => {
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`\\b${escaped}\\b`, 'i').test(body);
    });
    if (!found) return;
    const senderIsAdmin = await isAdmin(sock, sender, from, groupMetadata);
    const senderIsOwner = isOwner(sender);
    if (senderIsAdmin || senderIsOwner) return;
    const botIsAdmin = await isBotAdmin(sock, from, groupMetadata);
    if (!botIsAdmin) return;
    const action = (groupSettings.antibadwordAction || 'warn').toLowerCase();
    if (action === 'kick') {
      try {
        await sock.sendMessage(from, { delete: msg.key });
        await sock.groupParticipantsUpdate(from, [sender], 'remove');
        await sock.sendMessage(from, {
          text: `🤬 @${sender.split('@')[0]} was *kicked* for using a bad word: _${found}_`,
          mentions: [sender]
        });
      } catch (e) { console.error('AntiBadWord kick error:', e); }
    } else if (action === 'delete') {
      try {
        await sock.sendMessage(from, { delete: msg.key });
        await sock.sendMessage(from, {
          text: `🤬 @${sender.split('@')[0]}, watch your language! Bad word detected: _${found}_`,
          mentions: [sender]
        });
      } catch (e) { console.error('AntiBadWord delete error:', e); }
    } else {
      try {
        await sock.sendMessage(from, { delete: msg.key });
        const warnings = database.addWarning(from, sender, `Bad word: ${found}`);
        let text = `⚠️ @${sender.split('@')[0]}, you have been *warned* for using a bad word: _${found}_\n`;
        text += `Warnings: *${warnings.count}/${config.maxWarnings}*\n`;
        if (warnings.count >= config.maxWarnings) {
          text += `\n❌ Maximum warnings reached. You have been *removed* from the group!`;
          await sock.sendMessage(from, { text, mentions: [sender] });
          await sock.groupParticipantsUpdate(from, [sender], 'remove');
          database.clearWarnings(from, sender);
        } else {
          text += `\n_Further violations may result in a kick._`;
          await sock.sendMessage(from, { text, mentions: [sender] });
        }
      } catch (e) { console.error('AntiBadWord warn error:', e); }
    }
  } catch (error) {
    console.error('Error in antibadword handler:', error);
  }
};

// Anti-group mention handler
const handleAntigroupmention = async (sock, msg, groupMetadata) => {
  try {
    const from = msg.key.remoteJid;
    const groupSettings = database.getGroupSettings(from);
    if (!groupSettings.antigroupmention) return;
    let sender =
      msg.message?.groupStatusMentionMessage?.participant ||
      msg.key.participant ||
      msg.key.remoteJid;
    if (sender && sender.includes(':')) sender = sender.split(':')[0] + '@s.whatsapp.net';
    try {
      const _fs   = require('fs');
      const _path = require('path');
      const _dir  = _path.join(__dirname, 'data');
      if (!_fs.existsSync(_dir)) _fs.mkdirSync(_dir, { recursive: true });
      _fs.writeFileSync(
        _path.join(_dir, 'agm_debug.json'),
        JSON.stringify({
          ts: new Date().toISOString(), from, sender,
          keyParticipant: msg.key.participant,
          messageTypes: Object.keys(msg.message || {}),
          hasGSM: !!msg.message?.groupStatusMentionMessage,
          gsmParticipant: msg.message?.groupStatusMentionMessage?.participant || null,
          contextInfo: msg.message?.extendedTextMessage?.contextInfo ||
                       msg.message?.imageMessage?.contextInfo ||
                       msg.message?.contextInfo || null,
        }, null, 2)
      );
    } catch (_) {}
    let isStatusMention = false;
    if (msg.message) {
      if (msg.message.groupStatusMentionMessage) isStatusMention = true;
      if (msg.message.protocolMessage?.type === 25) isStatusMention = true;
      const checkCtx = (ctx) => {
        if (!ctx) return false;
        if (ctx.forwardedNewsletterMessageInfo) return true;
        if (ctx.externalAdReplyInfo?.sourceType === 'status') return true;
        if (Array.isArray(ctx.statusMentionedJidList) && ctx.statusMentionedJidList.length > 0) return true;
        if (Array.isArray(ctx.mentionedJid) && ctx.mentionedJid.some(j => j === from)) return true;
        return false;
      };
      const ctxSources = [
        msg.message.extendedTextMessage?.contextInfo,
        msg.message.imageMessage?.contextInfo,
        msg.message.videoMessage?.contextInfo,
        msg.message.stickerMessage?.contextInfo,
        msg.message.audioMessage?.contextInfo,
        msg.message.documentMessage?.contextInfo,
        msg.message.contextInfo,
      ];
      for (const ctx of ctxSources) {
        if (checkCtx(ctx)) { isStatusMention = true; break; }
      }
      const msgText =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        msg.message.videoMessage?.caption || '';
      if (/you mentioned this group|mentioned this group/i.test(msgText)) isStatusMention = true;
    }
    if (!isStatusMention) return;
    const senderIsAdmin = sender.endsWith('@g.us')
      ? false
      : await isAdmin(sock, sender, from, groupMetadata);
    const senderIsOwner = isOwner(sender);
    if (senderIsAdmin || senderIsOwner) return;
    const botIsAdmin = await isBotAdmin(sock, from, groupMetadata);
    if (!botIsAdmin) return;
    const action    = (groupSettings.antigroupmentionAction || 'delete').toLowerCase();
    const senderNum = sender.split('@')[0];
    if (action === 'warn') {
      const warnData = database.addWarning(from, sender, 'Status mention in group');
      const maxWarns = config.maxWarnings || 3;
      try { await sock.sendMessage(from, { delete: msg.key }); } catch (_) {}
      if (warnData.count >= maxWarns) {
        try {
          await sock.groupParticipantsUpdate(from, [sender], 'remove');
          await sock.sendMessage(from, {
            text: `🛡️ @${senderNum} has been removed.\n⚠️ Reached ${maxWarns}/${maxWarns} warnings for sharing a status that mentions this group.`,
            mentions: [sender],
          });
          database.clearWarnings(from, sender);
        } catch (e) { console.error('[AGM] Kick after max warns failed:', e.message); }
      } else {
        await sock.sendMessage(from, {
          text: `🛡️ @${senderNum} warned ⚠️\n\n📌 Reason: Shared a status that mentions this group\n⚠️ Warnings: ${warnData.count}/${maxWarns}\n\n_${maxWarns - warnData.count} more warning(s) before removal._`,
          mentions: [sender],
        });
      }
    } else if (action === 'kick') {
      try {
        await sock.sendMessage(from, { delete: msg.key });
        await sock.groupParticipantsUpdate(from, [sender], 'remove');
        await sock.sendMessage(from, {
          text: `🛡️ @${senderNum} has been removed for sharing a status that mentions this group.`,
          mentions: [sender],
        });
      } catch (e) { console.error('[AGM] Kick failed:', e.message); }
    } else {
      try {
        await sock.sendMessage(from, { delete: msg.key });
        await sock.sendMessage(from, {
          text: `🛡️ @${senderNum}'s message was deleted.\n📌 Reason: Sharing a status that mentions this group is not allowed here.`,
          mentions: [sender],
        });
      } catch (e) { console.error('[AGM] Delete failed:', e.message); }
    }
  } catch (error) {
    console.error('[AGM] Handler error:', error.message);
  }
};

const handleAntigroupstatus = async (sock, msg, groupMetadata) => {
  try {
    const from   = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;
    const groupSettings = database.getGroupSettings(from);
    if (!groupSettings.antigroupstatus) return;
    let isStatusMention = false;
    if (msg.message) {
      isStatusMention = isStatusMention || !!msg.message.groupStatusMentionMessage;
      isStatusMention = isStatusMention || (msg.message.protocolMessage?.type === 25);
      const checkCtx = (ctx) => {
        if (!ctx) return false;
        if (ctx.forwardedNewsletterMessageInfo) return true;
        if (ctx.externalAdReplyInfo?.sourceType === 'status') return true;
        return false;
      };
      if (msg.message.extendedTextMessage?.contextInfo) isStatusMention = isStatusMention || checkCtx(msg.message.extendedTextMessage.contextInfo);
      if (msg.message.imageMessage?.contextInfo)        isStatusMention = isStatusMention || checkCtx(msg.message.imageMessage.contextInfo);
      if (msg.message.videoMessage?.contextInfo)        isStatusMention = isStatusMention || checkCtx(msg.message.videoMessage.contextInfo);
      if (msg.message.contextInfo)                      isStatusMention = isStatusMention || checkCtx(msg.message.contextInfo);
    }
    if (!isStatusMention) return;
    const senderIsAdmin = await isAdmin(sock, sender, from, groupMetadata);
    const senderIsOwner = isOwner(sender);
    if (senderIsAdmin || senderIsOwner) return;
    const botIsAdmin = await isBotAdmin(sock, from, groupMetadata);
    if (!botIsAdmin) return;
    const action    = (groupSettings.antigroupstatusAction || 'delete').toLowerCase();
    const senderNum = sender.split('@')[0];
    if (action === 'warn') {
      const warnData = database.addWarning(from, sender, 'Status mention in group');
      const maxWarns = config.maxWarnings || 3;
      try { await sock.sendMessage(from, { delete: msg.key }); } catch (_) {}
      if (warnData.count >= maxWarns) {
        try {
          await sock.groupParticipantsUpdate(from, [sender], 'remove');
          await sock.sendMessage(from, {
            text: `🛡️ @${senderNum} has been removed.\n⚠️ Reached ${maxWarns}/${maxWarns} warnings for posting status mentions.`,
            mentions: [sender],
          });
          database.clearWarnings(from, sender);
        } catch (e) { console.error('Failed to kick for antigroupstatus warn:', e); }
      } else {
        await sock.sendMessage(from, {
          text: `🛡️ @${senderNum} warned ⚠️\n\n📌 Reason: Status mention in group\n⚠️ Warnings: ${warnData.count}/${maxWarns}\n\n_${maxWarns - warnData.count} more warning(s) before removal._`,
          mentions: [sender],
        });
      }
    } else if (action === 'kick') {
      try {
        await sock.sendMessage(from, { delete: msg.key });
        await sock.groupParticipantsUpdate(from, [sender], 'remove');
        await sock.sendMessage(from, {
          text: `🛡️ @${senderNum} has been removed for posting a status mention.`,
          mentions: [sender],
        });
      } catch (e) { console.error('Failed to kick for antigroupstatus:', e); }
    } else {
      try {
        await sock.sendMessage(from, { delete: msg.key });
        await sock.sendMessage(from, {
          text: `🛡️ Status mention by @${senderNum} deleted.\n_Status mentions are not allowed in this group._`,
          mentions: [sender],
        });
      } catch (e) { console.error('Failed to delete for antigroupstatus:', e); }
    }
  } catch (error) {
    console.error('Error in antigroupstatus handler:', error);
  }
};

const initializeAntiCall = (sock) => {
  sock.ev.on('messages.update', async (updates) => {
    try {
      const { WAMessageStubType } = require('@whiskeysockets/baileys');
      const revokeUpdates = updates.filter(item => item.update?.messageStubType === WAMessageStubType.REVOKE);
      if (revokeUpdates.length) {
        const antidelete = commands.get('antidelete');
        if (antidelete?.handleDelete) await antidelete.handleDelete(sock, revokeUpdates);
        const antideletestatus = commands.get('antideletestatus');
        if (antideletestatus?.handleStatusDelete) await antideletestatus.handleStatusDelete(sock, revokeUpdates);
      }
      const editUpdates = updates.filter(item =>
        item.update?.message?.editedMessage ||
        item.update?.message?.protocolMessage?.editedMessage
      );
      if (editUpdates.length) {
        const antiedit = commands.get('antiedit');
        if (antiedit?.handleAntiEdit) await antiedit.handleAntiEdit(sock, editUpdates);
      }
    } catch (_) {}
  });

  sock.ev.on('call', async (calls) => {
    try {
      delete require.cache[require.resolve('./config')];
      const config = require('./config');
      if (!config.defaultGroupSettings.anticall) return;
      const action = config.defaultGroupSettings.anticallAction || 'block';
      for (const call of calls) {
        if (call.status === 'offer') {
          await sock.rejectCall(call.id, call.from);
          if (action === 'block') {
            await sock.updateBlockStatus(call.from, 'block');
            await sock.sendMessage(call.from, { text: '🚫 Calls are not allowed. You have been blocked.' });
          }
        }
      }
    } catch (err) {
      console.error('[ANTICALL ERROR]', err);
    }
  });
};

const handleAntiMedia = async (sock, msg, groupMetadata) => {
  try {
    const from   = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;
    const groupSettings = database.getGroupSettings(from);
    function resolveType(message) {
      if (!message) return null;
      const top = Object.keys(message)[0];
      if (!top) return null;
      const wrappers = ['ephemeralMessage','viewOnceMessage','viewOnceMessageV2','viewOnceMessageV2Extension','documentWithCaptionMessage'];
      if (wrappers.includes(top)) {
        const inner = message[top]?.message;
        return inner ? Object.keys(inner)[0] : top;
      }
      return top;
    }
    const msgType = resolveType(msg.message);
    const checks = [
      { enabled: groupSettings.antiimage,   action: groupSettings.antiimageAction   || 'delete', label: 'Anti Image 🖼️',   types: ['imageMessage'] },
      { enabled: groupSettings.antisticker, action: groupSettings.antistickerAction || 'delete', label: 'Anti Sticker 🎭', types: ['stickerMessage'] },
      { enabled: groupSettings.antiaudio,   action: groupSettings.antiaudioAction   || 'delete', label: 'Anti Audio 🔇',   types: ['audioMessage', 'pttMessage'] },
    ];
    for (const check of checks) {
      if (!check.enabled) continue;
      if (!check.types.includes(msgType)) continue;
      const senderIsAdmin    = await isAdmin(sock, sender, from, groupMetadata);
      const senderIsOwnerChk = isOwner(sender);
      if (senderIsAdmin || senderIsOwnerChk) return;
      const botIsAdminChk = await isBotAdmin(sock, from, groupMetadata);
      if (!botIsAdminChk) return;
      const deleteKey = { remoteJid: from, fromMe: msg.key.fromMe || false, id: msg.key.id, participant: msg.key.participant || undefined };
      try { await sock.sendMessage(from, { delete: deleteKey }); } catch (_) {}
      const senderNum = sender.split('@')[0].split(':')[0];
      const divider   = '━━━━━━━━━━━━━━━━━━━━';
      let allMembers = [];
      try {
        const meta = groupMetadata || await sock.groupMetadata(from);
        allMembers = (meta?.participants || []).map(p => p.id);
      } catch (_) {}
      if (check.action === 'kick') {
        try {
          await sock.groupParticipantsUpdate(from, [sender], 'remove');
          await sock.sendMessage(from, {
            text: `${check.label}\n${divider}\n🚫 @${senderNum} has been *removed* from this group.\n📌 Reason: Sending ${check.label.replace(/Anti | 🖼️| 🎭| 🔇/g, '').trim().toLowerCase()} is not allowed here.\n${divider}`,
            mentions: allMembers,
          });
        } catch (_) {}
      } else if (check.action === 'warn') {
        const result   = database.addWarning(from, sender, check.label);
        const maxWarns = config.maxWarnings || 3;
        if (result.count >= maxWarns) {
          try {
            await sock.groupParticipantsUpdate(from, [sender], 'remove');
            database.clearWarnings(from, sender);
            await sock.sendMessage(from, {
              text: `${check.label}\n${divider}\n🚫 @${senderNum} has been *removed* from this group.\n📌 Reason: Reached maximum warnings (${maxWarns}/${maxWarns}) for sending ${check.label.replace(/Anti | 🖼️| 🎭| 🔇/g, '').trim().toLowerCase()}.\n${divider}`,
              mentions: allMembers,
            });
          } catch (_) {}
        } else {
          const pips = '⚠️'.repeat(result.count) + '⬜'.repeat(maxWarns - result.count);
          await sock.sendMessage(from, {
            text: `${check.label}\n${divider}\n⚠️ *WARNING* issued to @${senderNum}\n\n📌 Reason: Sending ${check.label.replace(/Anti | 🖼️| 🎭| 🔇/g, '').trim().toLowerCase()} is not allowed in this group.\n\n${pips}\nWarnings: *${result.count}/${maxWarns}*\n\n_${maxWarns - result.count} more warning(s) will result in removal._\n${divider}`,
            mentions: allMembers,
          });
        }
      } else {
        await sock.sendMessage(from, {
          text: `${check.label}\n${divider}\n🗑️ @${senderNum}'s message was deleted.\n📌 Sending ${check.label.replace(/Anti | 🖼️| 🎭| 🔇/g, '').trim().toLowerCase()} is not allowed here.\n${divider}`,
          mentions: allMembers,
        });
      }
      return;
    }
  } catch (error) {
    console.error('Error in antiMedia handler:', error);
  }
};

module.exports = {
  handleMessage,
  handleGroupUpdate,
  handleAntilink,
  handleAntibadword,
  handleAntigroupmention,
  handleAntigroupstatus,
  handleAntiMedia,
  initializeAntiCall,
  isOwner,
  isAdmin,
  isBotAdmin,
  isMod,
  isSudo,
  getGroupMetadata,
  findParticipant,
  getCommandCount: () => commands.size
};
