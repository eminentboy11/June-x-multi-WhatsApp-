/**
 * Message Handler - Processes incoming messages and executes commands
 */

const config = require('./config');
const database = require('./database');
const { loadCommands } = require('./utils/commandLoader');
const { addMessage, getActiveUsers, getInactiveUsers } = require('./utils/groupstats');
const { jidDecode, jidEncode } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Group metadata cache to prevent rate limiting
const groupMetadataCache = new Map();
const CACHE_TTL = 300000; // 5 minute cache (was 1 min)

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
    const db = require('./database');
    _autoReadCache = { mode: db.getBotSetting('autoReadMode') || 'off' };
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
  
  // You can add more wrappers if needed later
  return m;
};

// Cached group metadata getter with rate limit handling (for non-admin checks)
const getCachedGroupMetadata = async (sock, groupId) => {
  try {
    // Validate group JID before attempting to fetch
    if (!groupId || !groupId.endsWith('@g.us')) {
      return null;
    }
    
    // Check cache first
    const cached = groupMetadataCache.get(groupId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data; // Return cached data (even if null for forbidden groups)
    }
    
    // Fetch from API
    const metadata = await sock.groupMetadata(groupId);
    
    // Cache it
    groupMetadataCache.set(groupId, {
      data: metadata,
      timestamp: Date.now()
    });
    
    return metadata;
  } catch (error) {
    // Handle forbidden (403) errors - cache null to prevent retry storms
    if (error.message && (
      error.message.includes('forbidden') || 
      error.message.includes('403') ||
      error.statusCode === 403 ||
      error.output?.statusCode === 403 ||
      error.data === 403
    )) {
      // Cache null for forbidden groups to prevent repeated attempts
      groupMetadataCache.set(groupId, {
        data: null,
        timestamp: Date.now()
      });
      return null; // Silently return null for forbidden groups
    }
    
    // Handle rate limit errors
    if (error.message && error.message.includes('rate-overlimit')) {
      const cached = groupMetadataCache.get(groupId);
      if (cached) {
        return cached.data;
      }
      return null;
    }
    
    // For other errors, try cached data as fallback
    const cached = groupMetadataCache.get(groupId);
    if (cached) {
      return cached.data;
    }
    
    // Return null instead of throwing to prevent crashes
    return null;
  }
};

// Live group metadata getter (always fresh, no cache) - for admin checks
const getLiveGroupMetadata = async (sock, groupId) => {
  try {
    // Always fetch fresh metadata, bypass cache
    const metadata = await sock.groupMetadata(groupId);
    
    // Update cache for other features (antilink, welcome, etc.)
    groupMetadataCache.set(groupId, {
      data: metadata,
      timestamp: Date.now()
    });
    
    return metadata;
  } catch (error) {
    // On error, try cached data as fallback
    const cached = groupMetadataCache.get(groupId);
    if (cached) {
      return cached.data;
    }
    return null;
  }
};

// Alias for backward compatibility (non-admin features use cached)
const getGroupMetadata = getCachedGroupMetadata;

// Helper functions
const isOwner = (sender) => {
  if (!sender) return false;

  // Extract the raw phone/user number from sender (strips :device and @server)
  // Works for both standard JIDs (1234@s.whatsapp.net) and device-scoped ones (1234:5@s.whatsapp.net)
  const rawNum = sender.split('@')[0].split(':')[0];

  // Fast path: direct number match (catches normal and device-scoped JIDs)
  if (config.ownerNumber.some(o => o.replace(/\D/g, '') === rawNum)) return true;

  // LID-aware path: resolve LID JIDs to phone numbers via session mapping files
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
  // Normalize: strip @domain and :deviceId so "1234:7@s.whatsapp.net" → "1234"
  const number = sender.split('@')[0].split(':')[0];
  return database.isModerator(number);
};

// Alias for backward compat
const isMod = isSudo;

// LID mapping cache
const lidMappingCache = new Map();

// Periodically evict old groupMetadataCache entries (every 10 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of groupMetadataCache) {
    if (now - val.timestamp > 10 * 60 * 1000) groupMetadataCache.delete(key);
  }
  // Clear lid mapping cache completely every 10 minutes to prevent unbounded growth
  lidMappingCache.clear();
}, 10 * 60 * 1000);

// Helper to normalize JID to just the number part
const normalizeJid = (jid) => {
  if (!jid) return null;
  if (typeof jid !== 'string') return null;
  
  // Remove device ID if present (e.g., "1234567890:0@s.whatsapp.net" -> "1234567890")
  if (jid.includes(':')) {
    return jid.split(':')[0];
  }
  // Remove domain if present (e.g., "1234567890@s.whatsapp.net" -> "1234567890")
  if (jid.includes('@')) {
    return jid.split('@')[0];
  }
  return jid;
};

// Get LID mapping value from session files
const getLidMappingValue = (user, direction) => {
  if (!user) return null;
  
  const cacheKey = `${direction}:${user}`;
  if (lidMappingCache.has(cacheKey)) {
    return lidMappingCache.get(cacheKey);
  }
  
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

// Normalize JID handling LID conversion
const normalizeJidWithLid = (jid) => {
  if (!jid) return jid;
  
  try {
    const decoded = jidDecode(jid);
    if (!decoded?.user) {
      return `${jid.split(':')[0].split('@')[0]}@s.whatsapp.net`;
    }
    
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
    
    if (server === 'lid' || server === 'hosted.lid') {
      mapToPn();
    } else if (server === 's.whatsapp.net' || server === 'hosted') {
      mapToPn();
    }
    
    if (server === 'hosted') {
      return jidEncode(user, 'hosted');
    }
    return jidEncode(user, 's.whatsapp.net');
  } catch (error) {
    return jid;
  }
};

// Build comparable JID variants (PN + LID) for matching
const buildComparableIds = (jid) => {
  if (!jid) return [];
  
  try {
    const decoded = jidDecode(jid);
    if (!decoded?.user) {
      return [normalizeJidWithLid(jid)].filter(Boolean);
    }
    
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

// Find participant by either PN JID or LID JID
const findParticipant = (participants = [], userIds) => {
  const targets = (Array.isArray(userIds) ? userIds : [userIds])
    .filter(Boolean)
    .flatMap(id => buildComparableIds(id));
  
  if (!targets.length) return null;
  
  return participants.find(participant => {
    if (!participant) return false;
    
    const participantIds = [
      participant.id,
      participant.lid,
      participant.userJid
    ]
      .filter(Boolean)
      .flatMap(id => buildComparableIds(id));
    
    return participantIds.some(id => targets.includes(id));
  }) || null;
};

const isAdmin = async (sock, participant, groupId, groupMetadata = null) => {
  if (!participant) return false;
  
  // Early return for non-group JIDs (DMs) - prevents slow sock.groupMetadata() call
  if (!groupId || !groupId.endsWith('@g.us')) {
    return false;
  }
  
  // Always fetch live metadata for admin checks
  let liveMetadata = groupMetadata;
  if (!liveMetadata || !liveMetadata.participants) {
    if (groupId) {
      liveMetadata = await getLiveGroupMetadata(sock, groupId);
    } else {
      return false;
    }
  }
  
  if (!liveMetadata || !liveMetadata.participants) return false;
  
  // Use findParticipant to handle LID matching
  const foundParticipant = findParticipant(liveMetadata.participants, participant);
  if (!foundParticipant) return false;
  
  return foundParticipant.admin === 'admin' || foundParticipant.admin === 'superadmin';
};

const isBotAdmin = async (sock, groupId, groupMetadata = null) => {
  if (!sock.user || !groupId) return false;
  if (!groupId.endsWith('@g.us')) return false;

  // Return from cache if still fresh — avoids a live network call every message
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

    // Store result so the next ~2 minutes of messages skip the API call
    botAdminCache.set(groupId, { isAdmin, ts: Date.now() });
    return isAdmin;
  } catch {
    return false;
  }
};

const isUrl = (text) => {
  const urlRegex = /(https?:\/\/[^\s]+)/gi;
  return urlRegex.test(text);
};

const hasGroupLink = (text) => {
  const linkRegex = /chat.whatsapp.com\/([0-9A-Za-z]{20,24})/i;
  return linkRegex.test(text);
};

// System JID filter - checks if JID is from broadcast/status/newsletter
const isSystemJid = (jid) => {
  if (!jid) return true;
  return jid.includes('@broadcast') || 
         jid.includes('status.broadcast') || 
         jid.includes('@newsletter') ||
         jid.includes('@newsletter.');
};

// Main message handler
const handleMessage = async (sock, msg) => {
  try {
    // Debug logging to see all messages
    // Debug log removed
    
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

    const from = msg.key.remoteJid;
    
    // System message filter - ignore broadcast/status/newsletter messages
    if (isSystemJid(from)) {
      return; // Silently ignore system messages
    }
    
    // Auto-React System — uses short-lived cache to avoid disk read every message
    try {
      const arSettings = getCachedArSettings();
      if (arSettings.enabled && msg.message && !msg.key.fromMe) {
        const content = msg.message.ephemeralMessage?.message || msg.message;
        const text =
          content.conversation ||
          content.extendedTextMessage?.text ||
          '';

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
    
    // Unwrap containers first
    const content = getMessageContent(msg);
    // Note: We don't return early if content is null because forwarded status messages might not have content
    
    // Still check for actual message content for regular processing
    let actualMessageTypes = [];
    if (content) {
      const allKeys = Object.keys(content);
      // Filter out protocol/system messages and find actual message content
      const protocolMessages = ['protocolMessage', 'senderKeyDistributionMessage', 'messageContextInfo'];
      actualMessageTypes = allKeys.filter(key => !protocolMessages.includes(key));
    }
    
    // We'll check for empty content later after we've processed group messages
    
    // Use the first actual message type (conversation, extendedTextMessage, etc.)
    const messageType = actualMessageTypes[0];
    
    // from already defined above in DM block check
    const sender = msg.key.fromMe ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : msg.key.participant || msg.key.remoteJid;
    const isGroup = from.endsWith('@g.us'); // Should always be true now due to DM block above

    // ── Presence on ANY incoming message (DM or group, never bot's own) ──────
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
    // ─────────────────────────────────────────────────────────────────────────

    // ── Auto Read (blue-tick) on ANY incoming message ─────────────────────────
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
    // ─────────────────────────────────────────────────────────────────────────

    // Fetch group metadata immediately if it's a group
    const groupMetadata = isGroup ? await getGroupMetadata(sock, from) : null;
    
    // ── Muted-user enforcement: silently delete their messages ────────────────
    if (isGroup && !msg.key.fromMe && sender) {
      try {
        if (database.isUserMuted(from, sender)) {
          await sock.sendMessage(from, { delete: msg.key });
          return; // stop all further processing
        }
      } catch (_muteErr) {}
    }

    // Anti-* protection — run ALL checks in parallel so they don't queue behind each other
    if (isGroup) {
      const antispam     = commands.get('antispam');
      const antiviewonce = commands.get('antiviewonce');
      const antibot      = commands.get('antibot');
      const antiforward  = commands.get('antiforward');
      await Promise.allSettled([
        handleAntigroupmention(sock, msg, groupMetadata),
        handleAntigroupstatus(sock, msg, groupMetadata),
        handleAntiMedia(sock, msg, groupMetadata),
        handleAntilink(sock, msg, groupMetadata),
        antispam?.handleAntispam         ? antispam.handleAntispam(sock, msg, groupMetadata)         : Promise.resolve(),
        antiviewonce?.handleAntiviewonce ? antiviewonce.handleAntiviewonce(sock, msg)                : Promise.resolve(),
        antibot?.handleMessage           ? antibot.handleMessage(sock, msg, groupMetadata)           : Promise.resolve(),
        antiforward?.handleAntiforward   ? antiforward.handleAntiforward(sock, msg, groupMetadata)   : Promise.resolve(),
        handleAntibadword(sock, msg, groupMetadata),
      ]);
    }
    
    // AntiBug — crash-message protection for groups AND DMs
    try { await handleAntibug(sock, msg, groupMetadata, isGroup, sender, from); } catch (_) {}

    // Track group message statistics
    if (isGroup) {
      addMessage(from, sender);
    }
    
    // Return early for non-group messages with no recognizable content
    if (!content || actualMessageTypes.length === 0) return;
    
    // Button response — covers both buttonsResponseMessage and templateButtonReplyMessage
    const _btnResp = content.buttonsResponseMessage || msg.message?.buttonsResponseMessage;
    const _tplResp = content.templateButtonReplyMessage || msg.message?.templateButtonReplyMessage;
    const btn = _btnResp || _tplResp || null;
    if (btn) {
      const buttonId = _btnResp ? btn.selectedButtonId : btn.selectedId;

      // Helper to build the standard extra object for command execution
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

      // Handle button clicks by routing to commands
      if (buttonId === 'btn_menu') {
        const extra = await makeExtra();
        const menuCmd = commands.get('menu');
        if (menuCmd) await menuCmd.execute(sock, msg, [], extra);
        return;

      // ── Named menu buttons (non-prefixed IDs) ─────────────────────────────
      } else if (buttonId === 'menu_repo') {
        const repoUrl = config.social?.github || 'https://github.com/Vinpink2/June-Ultra';
        await sock.sendMessage(from, { text: `💻 *Bot Repository*\n${repoUrl}` }, { quoted: msg });
        return;

      } else if (buttonId === 'menu_yt') {
        const ytUrl = config.social?.youtube || 'http://youtube.com/@suprem_e_lord';
        await sock.sendMessage(from, { text: `📺 *YouTube Channel*\n${ytUrl}` }, { quoted: msg });
        return;

      // ── Ping / uptime — execute directly ──────────────────────────────────
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

      // ── Generic fallback: buttonId starts with the bot prefix → run as command
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
    
    // Get message body from unwrapped content
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
    
    // Check antiall protection (owner only feature)
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
      
      // Anti-tag protection (check BEFORE text check, as tagall can have no text)
      if (groupSettings.antitag && !msg.key.fromMe) {
        const ctx = content.extendedTextMessage?.contextInfo;
        const mentionedJids = ctx?.mentionedJid || [];
        
        const messageText = (
          body ||
          content.imageMessage?.caption ||
          content.videoMessage?.caption ||
          ''
        );
        
        const textMentions = messageText.match(/@[\d+\s\-()~.]+/g) || [];
        const numericMentions = messageText.match(/@\d{10,}/g) || [];
        
        const uniqueNumericMentions = new Set();
        numericMentions.forEach((mention) => {
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
                    await sock.sendMessage(from, { 
                      text: '⚠️ *Tagall Detected!*',
                      mentions: [sender]
                    }, { quoted: msg });
                  } catch (e) {
                    console.error('Failed to delete tagall message:', e);
                  }
                } else if (action === 'kick') {
                  try {
                    await sock.sendMessage(from, { delete: msg.key });
                  } catch (e) {
                    console.error('Failed to delete tagall message:', e);
                  }
                  
                  const botIsAdmin = await isBotAdmin(sock, from, groupMetadata);
                  if (botIsAdmin) {
                    try {
                      await sock.groupParticipantsUpdate(from, [sender], 'remove');
                    } catch (e) {
                      console.error('Failed to kick for antitag:', e);
                    }
                    const usernames = [`@${sender.split('@')[0]}`];
                    await sock.sendMessage(from, {
                      text: `🚫 *Antitag Detected!*\n\n${usernames.join(', ')} has been kicked for tagging all members.`,
                      mentions: [sender],
                    }, { quoted: msg });
                  }
                }
                return;
              }
            }
          } catch (e) {
            console.error('Error during anti-tag enforcement:', e);
          }
        }
      }
    }
    
    // AutoSticker feature - convert images/videos to stickers automatically
    if (isGroup) { // Process all messages in groups (including bot's own messages)
      const groupSettings = database.getGroupSettings(from);
      if (groupSettings.autosticker) {
        const mediaMessage = content?.imageMessage || content?.videoMessage;
        
        // Only process if it's an image or video (not documents)
        if (mediaMessage) {
          // Skip if message has a command prefix (let command handle it)
          if (!body.startsWith(config.prefix)) {
            try {
              // Import sticker command logic
              const stickerCmd = commands.get('sticker');
              if (stickerCmd) {
                // Execute sticker conversion silently
                await stickerCmd.execute(sock, msg, [], {
                  from,
                  sender,
                  isGroup,
                  groupMetadata,
                  isOwner: isOwner(sender),
                  isAdmin: await isAdmin(sock, sender, from, groupMetadata),
                  isBotAdmin: await isBotAdmin(sock, from, groupMetadata),
                  isMod: isMod(sender),
                  reply: (text) => sock.sendMessage(from, { text }, { quoted: msg }),
                  react: (emoji) => sock.sendMessage(from, { react: { text: emoji, key: msg.key } })
                });
                return; // Don't process as command after auto-converting
              }
            } catch (error) {
              console.error('[AutoSticker Error]:', error);
              // Continue to normal processing if autosticker fails
            }
          }
        }
      }
    }

     // Check for active bomb games (before prefix check)
    try {
      const bombModule = require('./commands/fun/bomb');
      if (bombModule.gameState && bombModule.gameState.has(sender)) {
        const bombCommand = commands.get('bomb');
        if (bombCommand && bombCommand.execute) {
          // User has active game, process input
          await bombCommand.execute(sock, msg, [], {
            from,
            sender,
            isGroup,
            groupMetadata,
            isOwner: isOwner(sender),
            isAdmin: await isAdmin(sock, sender, from, groupMetadata),
            isBotAdmin: await isBotAdmin(sock, from, groupMetadata),
            isMod: isMod(sender),
            reply: (text) => sock.sendMessage(from, { text }, { quoted: msg }),
            react: (emoji) => sock.sendMessage(from, { react: { text: emoji, key: msg.key } })
          });
          return; // Don't process as command
        }
      }
    } catch (e) {
      // Silently ignore if bomb command doesn't exist or has errors
    }
    
    // Check for active tictactoe games (before prefix check)
    try {
      const tictactoeModule = require('./commands/fun/tictactoe');
      if (tictactoeModule.handleTicTacToeMove) {
        // Check if user is in an active game
        const isInGame = Object.values(tictactoeModule.games || {}).some(room => 
          room.id.startsWith('tictactoe') && 
          [room.game.playerX, room.game.playerO].includes(sender) && 
          room.state === 'PLAYING'
        );
        
        if (isInGame) {
          // User has active game, process input
          const handled = await tictactoeModule.handleTicTacToeMove(sock, msg, {
            from,
            sender,
            isGroup,
            groupMetadata,
            isOwner: isOwner(sender),
            isAdmin: await isAdmin(sock, sender, from, groupMetadata),
            isBotAdmin: await isBotAdmin(sock, from, groupMetadata),
            isMod: isMod(sender),
            reply: (text) => sock.sendMessage(from, { text }, { quoted: msg }),
            react: (emoji) => sock.sendMessage(from, { react: { text: emoji, key: msg.key } })
          });
          if (handled) return; // Don't process as command if move was handled
        }
      }
    } catch (e) {
      // Silently ignore if tictactoe command doesn't exist or has errors
    }
    
    
    // Fancy text style selection: reply to fancy list with just a number
    if (/^\d+$/.test(body.trim())) {
      const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      const quotedText = quotedMsg?.conversation || quotedMsg?.extendedTextMessage?.text || '';
      if (quotedText.includes('Fancy Text Styles') || quotedText.includes('Fancy Styles for:')) {
        const fancyCmd = commands.get('fancy');
        if (fancyCmd) {
          return fancyCmd.execute(sock, msg, [body.trim()], {
            from,
            sender,
            reply: (text) => sock.sendMessage(from, { text }, { quoted: msg }),
            react: (emoji) => sock.sendMessage(from, { react: { text: emoji, key: msg.key } }),
          });
        }
      }
    }

    // My groups: reply to group list with just a number to get group details
    if (/^\d+$/.test(body.trim())) {
      const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      const quotedText = quotedMsg?.conversation || quotedMsg?.extendedTextMessage?.text || '';
      if (quotedText.includes('📋') && quotedText.includes('Group List')) {
        const mygroupsCmd = commands.get('mygroups');
        if (mygroupsCmd) {
          return mygroupsCmd.execute(sock, msg, [body.trim()], {
            from,
            sender,
            command: 'mygroups',
            prefix: config.prefix,
            reply: (text) => sock.sendMessage(from, { text }, { quoted: msg }),
            react: (emoji) => sock.sendMessage(from, { react: { text: emoji, key: msg.key } }),
          });
        }
      }
    }

    // ── Chatbot auto-reply (group or DM) ────────────────────────────────────────
    if (!body.startsWith(config.prefix)) {
        if (body.trim() && !msg.key.fromMe) {
            try {
                const chatbotCmd = commands.get('chatbot');
                if (chatbotCmd?.handleAutoReply) {
                    await chatbotCmd.handleAutoReply(sock, msg, { from, isGroup });
                }
            } catch (e) {
                // Never let chatbot errors break the message handler
            }
        }
        return;
    }
    // ────────────────────────────────────────────────────────────────────────────

    // Parse command
    const args = body.slice(config.prefix.length).trim().split(/\s+/);
    const commandName = args.shift().toLowerCase();
    
    // Get command
    const command = commands.get(commandName);
    if (!command) return;
    
    // fromMe = message sent by the bot's own number → always treat as owner
    // ── Resolve LID sender → phone number JID (Baileys 7.x LID support) ──────
    // In newer WhatsApp (7.x RC), senders in both groups AND DMs are identified
    // by LID (@lid / @hosted.lid) instead of phone number JIDs.  We resolve them
    // so that owner/sudo checks work correctly everywhere.
    //
    // Detection: use jidDecode server field — the only reliable signal for LIDs.
    // Resolution: only accept the result when getLidMappingValue returns a real
    // phone-number mapping; never accept a synthetic fallback as "resolved".
    let resolvedSender = sender;
    try {
      const { jidDecode: _jidDec } = require('@whiskeysockets/baileys');
      const { getLidMappingValue } = require('./utils/jidHelper');
      const decoded = sender ? _jidDec(sender) : null;
      const server  = decoded?.server;
      const isLidServer = server === 'lid' || server === 'hosted.lid';

      if (isLidServer && decoded?.user) {
        if (isGroup && groupMetadata?.participants) {
          // Group path: resolve via participant list (most authoritative for groups)
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
          // Fallback to mapping file if participant list had no phoneNumber
          if (resolvedSender === sender) {
            const pnUser = getLidMappingValue(decoded.user, 'lidToPn');
            if (pnUser) resolvedSender = `${pnUser}@s.whatsapp.net`;
          }
        } else if (!isGroup) {
          // DM path: only resolve when a real lidToPn mapping exists on disk
          const pnUser = getLidMappingValue(decoded.user, 'lidToPn');
          if (pnUser) resolvedSender = `${pnUser}@s.whatsapp.net`;
          // No mapping → keep original sender; do not synthesize a phone JID
        }
      }
    } catch (_lidErr) {
      // Never let resolution errors block command execution
    }
    // ─────────────────────────────────────────────────────────────────────────

    const senderIsOwner = msg.key.fromMe || isOwner(resolvedSender);
    const senderIsSudo  = senderIsOwner || isSudo(resolvedSender);

    // Bot mode check
    {
      const { getMode } = require('./utils/botMode');
      const botModeVal = getMode();
      if (botModeVal === 'private' && !senderIsSudo) {
        return;
      }
      if (botModeVal === 'group' && !isGroup && !senderIsSudo) {
        return;
      }
      if (botModeVal === 'pm' && isGroup && !senderIsSudo) {
        return;
      }
    }
    
    // Permission checks
    if (command.ownerOnly && !senderIsOwner && !senderIsSudo) {
      return sock.sendMessage(from, { text: config.messages.ownerOnly }, { quoted: msg });
    }
    
    if (command.modOnly && !senderIsSudo) {
      return sock.sendMessage(from, { text: '🔒 This command is only for moderators!' }, { quoted: msg });
    }
    
    if (command.groupOnly && !isGroup) {
      return sock.sendMessage(from, { text: config.messages.groupOnly }, { quoted: msg });
    }
    
    if (command.privateOnly && isGroup) {
      return sock.sendMessage(from, { text: config.messages.privateOnly }, { quoted: msg });
    }
    
    if (command.adminOnly && !(await isAdmin(sock, sender, from, groupMetadata)) && !senderIsOwner) {
      return sock.sendMessage(from, { text: config.messages.adminOnly }, { quoted: msg });
    }
    
    if (command.botAdminNeeded) {
      const botIsAdmin = await isBotAdmin(sock, from, groupMetadata);
      if (!botIsAdmin) {
        return sock.sendMessage(from, { text: config.messages.botAdminNeeded }, { quoted: msg });
      }
    }
    
    // Auto presence indicators — read from database/bot-settings.json via presenceSettings
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
        // legacy config.js flag fallback
        await sock.sendPresenceUpdate('composing', from);
        await new Promise(r => setTimeout(r, 800));
      }
    } catch (presenceErr) {
      // Never let presence failure block the command
      console.error('[PRESENCE] error:', presenceErr.message);
    }
    
    // Colored command execution log
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
      from,
      sender,
      isGroup,
      groupMetadata,
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
    
    // Don't send error messages for rate limit errors
    if (error.message && error.message.includes('rate-overlimit')) {
      console.warn('⚠️ Rate limit reached. Skipping error message.');
      return;
    }
    
    try {
      await sock.sendMessage(msg.key.remoteJid, { 
        text: `${config.messages.error}\n\n${error.message}` 
      }, { quoted: msg });
    } catch (e) {
      // Don't log rate limit errors when sending error messages
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
    
    // Validate group JID before processing
    if (!id || !id.endsWith('@g.us')) {
      return;
    }

    // ── AntiDemote / AntiPromote ────────────────────────────────────────
    if (action === 'demote' || action === 'promote') {
      try {
        const antidemoteCmd  = commands.get('antidemote');
        const antipromoteCmd = commands.get('antipromote');

        // Resolve actor — could be a lid JID; normalize to phone JID
        let resolvedActor = actor || null;
        if (resolvedActor) {
          try { resolvedActor = normalizeJidWithLid(resolvedActor) || resolvedActor; } catch (_) {}
        }

        for (const participant of participants) {
          // Participants may be plain string JIDs or objects with phoneNumber/pn
          let pJid = typeof participant === 'string'
            ? participant
            : (participant?.phoneNumber || participant?.pn || participant?.id || participant?.jid || null);
          if (!pJid) continue;

          if (action === 'demote' && antidemoteCmd?.handleDemote) {
            await antidemoteCmd.handleDemote(sock, id, resolvedActor, pJid);
          }
          if (action === 'promote' && antipromoteCmd?.handlePromote) {
            await antipromoteCmd.handlePromote(sock, id, resolvedActor, pJid);
          }
        }
      } catch (e) {
        console.error('[handleGroupUpdate] antidemote/antipromote error:', e.message);
      }
    }

    const groupSettings = database.getGroupSettings(id);
    
    if (!groupSettings.welcome && !groupSettings.goodbye) return;
    
    const groupMetadata = await getGroupMetadata(sock, id);
    if (!groupMetadata) return; // Skip if metadata unavailable (forbidden or error)
    
    // Helper to extract participant JID
    const getParticipantJid = (participant) => {
      if (typeof participant === 'string') {
        return participant;
      }
      if (participant && participant.id) {
        return participant.id;
      }
      if (participant && typeof participant === 'object') {
        // Try to find JID in object
        return participant.jid || participant.participant || null;
      }
      return null;
    };
    
    for (const participant of participants) {
      const participantJid = getParticipantJid(participant);
      if (!participantJid) {
        console.warn('Could not extract participant JID:', participant);
        continue;
      }
      
      const participantNumber = participantJid.split('@')[0];
      
      if (action === 'add') {
        // AntiBot check on join
        try {
          const antibot = commands.get('antibot');
          if (antibot?.handleGroupJoin) await antibot.handleGroupJoin(sock, id, participantJid);
        } catch (_) {}

        // AntiForeign check on join
        try {
          const antiforeign = commands.get('antiforeign');
          if (antiforeign?.handleGroupJoin) await antiforeign.handleGroupJoin(sock, id, participantJid);
        } catch (_) {}
      }

      // ── Shared helpers for welcome / goodbye ──────────────────────────────
      const buildMsg = (template, vars) => {
        return (template || '')
          .replace(/@user/g, `@${vars.number}`)
          .replace(/@group/g, vars.groupName)
          .replace(/groupDesc/g, vars.groupDesc)
          .replace(/time/g, vars.timeString)
          .replace(/#memberCount/g, String(vars.memberCount))
          .replace(/botName/g, config.botName);
      };

      // Fetch profile pic as Buffer: tries member first, then group, returns null if both fail
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
      // ─────────────────────────────────────────────────────────────────────

      if (action === 'add' && groupSettings.welcome) {
        try {
          const groupName  = groupMetadata.subject || 'the group';
          const groupDesc  = groupMetadata.desc || 'No description';
          const now        = new Date();
          const timeString = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
          const memberCount = groupMetadata.participants.length;

          const msgText = buildMsg(
            groupSettings.welcomeMessage,
            { number: participantNumber, groupName, groupDesc, timeString, memberCount }
          );

          const noPP = groupSettings.welcomeNoPP === true;

          if (noPP) {
            await sock.sendMessage(id, { text: msgText, mentions: [participantJid] });
          } else {
            const ppBuffer = await fetchPpBuffer(participantJid, id);
            if (ppBuffer) {
              await sock.sendMessage(id, {
                image: ppBuffer,
                caption: msgText,
                mentions: [participantJid]
              });
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
          const groupName  = groupMetadata.subject || 'the group';
          const groupDesc  = groupMetadata.desc || 'No description';
          const now        = new Date();
          const timeString = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
          const memberCount = groupMetadata.participants.length;

          const msgText = buildMsg(
            groupSettings.goodbyeMessage,
            { number: participantNumber, groupName, groupDesc, timeString, memberCount }
          );

          const noPP = groupSettings.welcomeNoPP === true;

          if (noPP) {
            await sock.sendMessage(id, { text: msgText, mentions: [participantJid] });
          } else {
            const ppBuffer = await fetchPpBuffer(participantJid, id);
            if (ppBuffer) {
              await sock.sendMessage(id, {
                image: ppBuffer,
                caption: msgText,
                mentions: [participantJid]
              });
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
    // Silently handle forbidden errors and other group metadata errors
    if (error.message && (
      error.message.includes('forbidden') || 
      error.message.includes('403') ||
      error.statusCode === 403 ||
      error.output?.statusCode === 403 ||
      error.data === 403
    )) {
      // Silently skip forbidden groups
      return;
    }
    // Only log non-forbidden errors
    if (!error.message || !error.message.includes('forbidden')) {
      console.error('Error handling group update:', error);
    }
  }
};

// Antilink handler
const handleAntilink = async (sock, msg, groupMetadata) => {
  try {
    const from = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;
    
    const groupSettings = database.getGroupSettings(from);
    if (!groupSettings.antilink) return;
    
    const body = msg.message?.conversation || 
                  msg.message?.extendedTextMessage?.text || 
                  msg.message?.imageMessage?.caption || 
                  msg.message?.videoMessage?.caption || '';
    
    // Link detection: matches URLs with a protocol, or well-known link patterns.
    // Requires http(s):// for generic domains so version strings like "v1.2.3"
    // or decimals like "5.00" are NOT falsely flagged.
    const linkPattern = /https?:\/\/[^\s]+|t\.me\/[^\s]+|wa\.me\/[^\s]+|chat\.whatsapp\.com\/[^\s]+/i;
    
    // Check for any links (with or without protocol)
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
        // delete (default)
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
    const from = msg.key.remoteJid;
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
      } catch (e) {
        console.error('AntiBadWord kick error:', e);
      }

    } else if (action === 'delete') {
      try {
        await sock.sendMessage(from, { delete: msg.key });
        await sock.sendMessage(from, {
          text: `🤬 @${sender.split('@')[0]}, watch your language! Bad word detected: _${found}_`,
          mentions: [sender]
        });
      } catch (e) {
        console.error('AntiBadWord delete error:', e);
      }

    } else {
      // Default: warn
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
      } catch (e) {
        console.error('AntiBadWord warn error:', e);
      }
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

    // ── Sender detection ──────────────────────────────────────────────────────
    // groupStatusMentionMessage stores the real sender inside the nested object.
    // Fall back to msg.key.participant, then remoteJid as last resort.
    let sender =
      msg.message?.groupStatusMentionMessage?.participant ||
      msg.key.participant ||
      msg.key.remoteJid;

    // Normalise: strip device suffix (:X) so JID comparisons work
    if (sender && sender.includes(':')) {
      sender = sender.split(':')[0] + '@s.whatsapp.net';
    }

    // ── Diagnostics: write last-seen status-mention message to file ───────────
    try {
      const _fs   = require('fs');
      const _path = require('path');
      const _dir  = _path.join(__dirname, 'data');
      if (!_fs.existsSync(_dir)) _fs.mkdirSync(_dir, { recursive: true });
      _fs.writeFileSync(
        _path.join(_dir, 'agm_debug.json'),
        JSON.stringify({
          ts: new Date().toISOString(),
          from,
          sender,
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

    // ── Detection ─────────────────────────────────────────────────────────────
    let isStatusMention = false;

    if (msg.message) {
      // 1. Direct Baileys type
      if (msg.message.groupStatusMentionMessage) isStatusMention = true;

      // 2. protocolMessage type 25 (ephemeral status mention)
      if (msg.message.protocolMessage?.type === 25) isStatusMention = true;

      // 3. contextInfo-based checks across all message types
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

      // 4. Text-based fallback — WhatsApp embeds this exact phrase in the message
      const msgText =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        msg.message.videoMessage?.caption || '';
      if (/you mentioned this group|mentioned this group/i.test(msgText)) isStatusMention = true;
    }

    if (!isStatusMention) return;

    // ── Guards ────────────────────────────────────────────────────────────────
    const senderIsAdmin = sender.endsWith('@g.us')
      ? false  // group JID is never a user admin — skip check
      : await isAdmin(sock, sender, from, groupMetadata);
    const senderIsOwner = isOwner(sender);
    if (senderIsAdmin || senderIsOwner) return;

    const botIsAdmin = await isBotAdmin(sock, from, groupMetadata);
    if (!botIsAdmin) {
      console.log('[AGM] Bot is not admin — cannot take action in', from);
      return;
    }

    // ── Actions ───────────────────────────────────────────────────────────────
    const action    = (groupSettings.antigroupmentionAction || 'delete').toLowerCase();
    const senderNum = sender.split('@')[0];

    if (action === 'warn') {
      const warnData  = database.addWarning(from, sender, 'Status mention in group');
      const maxWarns  = config.maxWarnings || 3;
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
      // delete (default)
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
    const from = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;
    const groupSettings = database.getGroupSettings(from);

    if (!groupSettings.antigroupstatus) return;

    let isStatusMention = false;

    if (msg.message) {
      isStatusMention = isStatusMention || !!msg.message.groupStatusMentionMessage;
      isStatusMention = isStatusMention ||
        (msg.message.protocolMessage && msg.message.protocolMessage.type === 25);

      const checkCtx = (ctx) => {
        if (!ctx) return false;
        if (ctx.forwardedNewsletterMessageInfo) return true;
        if (ctx.externalAdReplyInfo?.sourceType === 'status') return true;
        return false;
      };

      if (msg.message.extendedTextMessage?.contextInfo)
        isStatusMention = isStatusMention || checkCtx(msg.message.extendedTextMessage.contextInfo);
      if (msg.message.imageMessage?.contextInfo)
        isStatusMention = isStatusMention || checkCtx(msg.message.imageMessage.contextInfo);
      if (msg.message.videoMessage?.contextInfo)
        isStatusMention = isStatusMention || checkCtx(msg.message.videoMessage.contextInfo);
      if (msg.message.contextInfo)
        isStatusMention = isStatusMention || checkCtx(msg.message.contextInfo);
    }

    if (!isStatusMention) return;

    const senderIsAdmin = await isAdmin(sock, sender, from, groupMetadata);
    const senderIsOwner = isOwner(sender);
    if (senderIsAdmin || senderIsOwner) return;

    const botIsAdmin = await isBotAdmin(sock, from, groupMetadata);
    if (!botIsAdmin) return;

    const action = (groupSettings.antigroupstatusAction || 'delete').toLowerCase();
    const senderNum = sender.split('@')[0];

    if (action === 'warn') {
      const warnData = database.addWarning(from, sender, 'Status mention in group');
      const maxWarns = config.maxWarnings || 3;
      try {
        await sock.sendMessage(from, { delete: msg.key });
      } catch (_) {}
      if (warnData.count >= maxWarns) {
        try {
          await sock.groupParticipantsUpdate(from, [sender], 'remove');
          await sock.sendMessage(from, {
            text: `🛡️ @${senderNum} has been removed.\n⚠️ Reached ${maxWarns}/${maxWarns} warnings for posting status mentions.`,
            mentions: [sender],
          });
          database.clearWarnings(from, sender);
        } catch (e) {
          console.error('Failed to kick for antigroupstatus warn:', e);
        }
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
      } catch (e) {
        console.error('Failed to kick for antigroupstatus:', e);
      }
    } else {
      try {
        await sock.sendMessage(from, { delete: msg.key });
        await sock.sendMessage(from, {
          text: `🛡️ Status mention by @${senderNum} deleted.\n_Status mentions are not allowed in this group._`,
          mentions: [sender],
        });
      } catch (e) {
        console.error('Failed to delete for antigroupstatus:', e);
      }
    }
  } catch (error) {
    console.error('Error in antigroupstatus handler:', error);
  }
};

// Anti-call feature initializer
const initializeAntiCall = (sock) => {
  // AntiDelete — Baileys v7 signals deletions via messages.update with stubType REVOKE (1)
  // AntiEdit  — edits arrive as messages.update with update.message.editedMessage
  // messages.delete does NOT fire in this version
  sock.ev.on('messages.update', async (updates) => {
    try {
      const { WAMessageStubType } = require('@whiskeysockets/baileys');

      // Handle deletions
      const revokeUpdates = updates.filter(
        item => item.update?.messageStubType === WAMessageStubType.REVOKE
      );
      if (revokeUpdates.length) {
        const antidelete = commands.get('antidelete');
        if (antidelete?.handleDelete) await antidelete.handleDelete(sock, revokeUpdates);

        // Status deletions
        const antideletestatus = commands.get('antideletestatus');
        if (antideletestatus?.handleStatusDelete) await antideletestatus.handleStatusDelete(sock, revokeUpdates);
      }

      // Handle edits
      const editUpdates = updates.filter(
        item => item.update?.message?.editedMessage || item.update?.message?.protocolMessage?.editedMessage
      );
      if (editUpdates.length) {
        const antiedit = commands.get('antiedit');
        if (antiedit?.handleAntiEdit) await antiedit.handleAntiEdit(sock, editUpdates);
      }
    } catch (_) {}
  });

  // Anti-call feature — decline/block incoming calls
  sock.ev.on('call', async (calls) => {
    try {
      // Reload config to get fresh settings
      delete require.cache[require.resolve('./config')];
      const config = require('./config');

      if (!config.defaultGroupSettings.anticall) return;

      const action = config.defaultGroupSettings.anticallAction || 'block';

      for (const call of calls) {
        if (call.status === 'offer') {
          // Decline the call
          await sock.rejectCall(call.id, call.from);

          // Block the caller if action is 'block' or 'on'
          if (action === 'block') {
            await sock.updateBlockStatus(call.from, 'block');

            // Notify user
            await sock.sendMessage(call.from, {
              text: '🚫 Calls are not allowed. You have been blocked.'
            });
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

    // ── Resolve real media type through all Baileys wrappers ────────────────
    // Stickers/images can arrive inside ephemeralMessage, viewOnceMessageV2, etc.
    function resolveType(message) {
      if (!message) return null;
      const top = Object.keys(message)[0];
      if (!top) return null;
      const wrappers = [
        'ephemeralMessage',
        'viewOnceMessage',
        'viewOnceMessageV2',
        'viewOnceMessageV2Extension',
        'documentWithCaptionMessage',
      ];
      if (wrappers.includes(top)) {
        const inner = message[top]?.message;
        return inner ? Object.keys(inner)[0] : top;
      }
      return top;
    }

    const msgType = resolveType(msg.message);

    // GIF detection: videoMessage with gifPlayback === true
    const isGif = (() => {
      const vm = msg.message?.videoMessage ||
                 msg.message?.ephemeralMessage?.message?.videoMessage ||
                 msg.message?.viewOnceMessageV2?.message?.videoMessage;
      return !!(vm?.gifPlayback);
    })();

    const checks = [
      { enabled: groupSettings.antiimage,   action: groupSettings.antiimageAction   || 'delete', label: 'Anti Image 🖼️',    types: ['imageMessage'] },
      { enabled: groupSettings.antisticker, action: groupSettings.antistickerAction || 'delete', label: 'Anti Sticker 🎭',  types: ['stickerMessage'] },
      { enabled: groupSettings.antiaudio,   action: groupSettings.antiaudioAction   || 'delete', label: 'Anti Audio 🔇',    types: ['audioMessage', 'pttMessage'] },
      { enabled: groupSettings.anticontact, action: groupSettings.anticontactAction || 'delete', label: 'Anti Contact 📇',  types: ['contactMessage', 'contactsArrayMessage'] },
      { enabled: groupSettings.antigif && isGif, action: groupSettings.antigifAction || 'delete', label: 'Anti GIF 🎞️',    types: ['videoMessage'] },
    ];

    for (const check of checks) {
      if (!check.enabled) continue;
      if (!check.types.includes(msgType)) continue;

      const senderIsAdmin    = await isAdmin(sock, sender, from, groupMetadata);
      const senderIsOwnerChk = isOwner(sender);
      if (senderIsAdmin || senderIsOwnerChk) return;

      const botIsAdminChk = await isBotAdmin(sock, from, groupMetadata);
      if (!botIsAdminChk) return;

      // ── Delete the message ─────────────────────────────────────────────────
      // Build a clean key — some wrappers need the participant set explicitly
      const deleteKey = {
        remoteJid:   from,
        fromMe:      msg.key.fromMe || false,
        id:          msg.key.id,
        participant: msg.key.participant || undefined,
      };
      try { await sock.sendMessage(from, { delete: deleteKey }); } catch (_) {}

      const senderNum = sender.split('@')[0].split(':')[0];
      const divider   = '━━━━━━━━━━━━━━━━━━━━';

      // ── Fetch all group members for group-wide @mention ────────────────────
      let allMembers = [];
      try {
        const meta = groupMetadata || await sock.groupMetadata(from);
        allMembers = (meta?.participants || []).map(p => p.id);
      } catch (_) {}

      if (check.action === 'kick') {
        try {
          await sock.groupParticipantsUpdate(from, [sender], 'remove');
          await sock.sendMessage(from, {
            text:
              `${check.label}\n${divider}\n` +
              `🚫 @${senderNum} has been *removed* from this group.\n` +
              `📌 Reason: Sending ${check.label.replace(/Anti | 🖼️| 🎭| 🔇/g, '').trim().toLowerCase()} is not allowed here.\n` +
              `${divider}`,
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
              text:
                `${check.label}\n${divider}\n` +
                `🚫 @${senderNum} has been *removed* from this group.\n` +
                `📌 Reason: Reached maximum warnings (${maxWarns}/${maxWarns}) for sending ${check.label.replace(/Anti | 🖼️| 🎭| 🔇/g, '').trim().toLowerCase()}.\n` +
                `${divider}`,
              mentions: allMembers,
            });
          } catch (_) {}
        } else {
          // Build warning pips e.g. ⚠️⚠️⬜ for 2/3
          const pips = '⚠️'.repeat(result.count) + '⬜'.repeat(maxWarns - result.count);
          await sock.sendMessage(from, {
            text:
              `${check.label}\n${divider}\n` +
              `⚠️ *WARNING* issued to @${senderNum}\n\n` +
              `📌 Reason: Sending ${check.label.replace(/Anti | 🖼️| 🎭| 🔇/g, '').trim().toLowerCase()} is not allowed in this group.\n\n` +
              `${pips}\n` +
              `Warnings: *${result.count}/${maxWarns}*\n\n` +
              `_${maxWarns - result.count} more warning(s) will result in removal._\n` +
              `${divider}`,
            mentions: allMembers,
          });
        }

      } else {
        // delete-only mode
        await sock.sendMessage(from, {
          text:
            `${check.label}\n${divider}\n` +
            `🗑️ @${senderNum}'s message was deleted.\n` +
            `📌 Sending ${check.label.replace(/Anti | 🖼️| 🎭| 🔇/g, '').trim().toLowerCase()} is not allowed here.\n` +
            `${divider}`,
          mentions: allMembers,
        });
      }
      return;
    }
  } catch (error) {
    console.error('Error in antiMedia handler:', error);
  }
};

// ── AntiBug crash-pattern detection ─────────────────────────────────────────
const CRASH_PATTERNS = [
  /\u0000/,                       // Null byte injection
  /\u202E{2,}/,                   // RTL override repeated
  /[\u200B-\u200D\uFEFF]{10,}/,   // Invisible / zero-width char flood
  /[\u0300-\u036f]{8,}/,          // Zalgo combining-mark attack
  /(.)\1{500,}/,                  // Single character repeated 500+ times
  /[\u{E0000}-\u{E007F}]/u,       // Unicode tag block (known WA crash vector)
];

const isCrashMessage = (text) => {
  if (!text || typeof text !== 'string') return false;
  for (const p of CRASH_PATTERNS) {
    try { if (p.test(text)) return true; } catch (_) {}
  }
  return false;
};

// ── AntiBug handler — called for every incoming message ─────────────────────
const handleAntibug = async (sock, msg, groupMetadata, isGroup, sender, from) => {
  try {
    if (!database.getBotSetting('antibug')) return;
    if (msg.key.fromMe) return;

    const text =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      msg.message?.videoMessage?.caption ||
      msg.message?.documentMessage?.caption || '';

    if (!isCrashMessage(text)) return;

    const senderNum = (sender || from).split('@')[0].split(':')[0];
    const action    = database.getBotSetting('antibugAction') || 'delete';

    console.log(`[ANTIBUG] Crash message detected from ${senderNum} in ${isGroup ? 'group' : 'DM'} ${from}`);

    if (isGroup) {
      const senderIsAdminVal = await isAdmin(sock, sender, from, groupMetadata);
      const senderIsOwnerVal = isOwner(sender);
      if (senderIsAdminVal || senderIsOwnerVal) return;

      const botIsAdminVal = await isBotAdmin(sock, from, groupMetadata);

      if (!botIsAdminVal) {
        // Cannot delete — leave group to protect bot
        try { await sock.groupLeave(from); } catch (_) {}
        for (const ownerNum of config.ownerNumber) {
          try {
            await sock.sendMessage(`${ownerNum}@s.whatsapp.net`, {
              text:
                `🛡️ *AntiBug Alert*\n` +
                `Left group *${groupMetadata?.subject || from}*\n` +
                `Reason: crash message detected from *${senderNum}* but bot is not admin.`
            });
          } catch (_) {}
        }
        return;
      }

      // Bot is admin — delete message then take action
      try { await sock.sendMessage(from, { delete: msg.key }); } catch (_) {}

      if (action === 'kick') {
        try {
          await sock.groupParticipantsUpdate(from, [sender], 'remove');
          await sock.sendMessage(from, {
            text: `🛡️ *AntiBug* — @${senderNum} was *removed* for sending a crash message.`,
            mentions: [sender]
          });
        } catch (_) {}

      } else if (action === 'warn') {
        const result   = database.addWarning(from, sender, 'Crash message (AntiBug)');
        const maxWarns = config.maxWarnings || 3;
        if (result.count >= maxWarns) {
          try {
            await sock.groupParticipantsUpdate(from, [sender], 'remove');
            database.clearWarnings(from, sender);
            await sock.sendMessage(from, {
              text:
                `🛡️ *AntiBug* — @${senderNum} was *removed*.\n` +
                `Reached max warnings (${maxWarns}/${maxWarns}) for crash messages.`,
              mentions: [sender]
            });
          } catch (_) {}
        } else {
          await sock.sendMessage(from, {
            text:
              `🛡️ *AntiBug* ⚠️ Warning to @${senderNum}\n` +
              `Crash message deleted. Warnings: *${result.count}/${maxWarns}*`,
            mentions: [sender]
          });
        }

      } else {
        // delete-only
        try {
          await sock.sendMessage(from, {
            text: `🛡️ *AntiBug* — Crash message from @${senderNum} deleted.`,
            mentions: [sender]
          });
        } catch (_) {}
      }

    } else {
      // DM — block sender + notify owner
      try { await sock.updateBlockStatus(sender, 'block'); } catch (_) {}
      for (const ownerNum of config.ownerNumber) {
        try {
          await sock.sendMessage(`${ownerNum}@s.whatsapp.net`, {
            text:
              `🛡️ *AntiBug Alert — DM*\n` +
              `Blocked *${senderNum}* for sending a crash/bug message in private chat.`
          });
        } catch (_) {}
      }
    }
  } catch (e) {
    console.error('[ANTIBUG]', e.message);
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
  handleAntibug,
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
