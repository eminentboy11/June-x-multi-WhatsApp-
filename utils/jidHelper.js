/**
 * JID Helper Utilities for LID-aware matching
 * Shared by promote, demote, and other commands
 */

const { jidDecode, jidEncode } = require('@whiskeysockets/baileys');
const path = require('path');
const fs = require('fs');
const config = require('../config');

// LID mapping cache
const lidMappingCache = new Map();

// Get LID mapping value from files
const getLidMappingValue = (user, direction) => {
  if (!user) return null;
  const cacheKey = `${direction}:${user}`;
  if (lidMappingCache.has(cacheKey)) {
    return lidMappingCache.get(cacheKey);
  }
  
  const sessionPath = path.join(__dirname, '..', config.sessionName || 'session');
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

/**
 * Build a list of candidate JIDs to try for a target user, handling
 * @lid → phone-number resolution using both the lid-mapping cache and
 * the current group's participant list (which contains phoneNumber/pn).
 */
const resolveTargetJidVariants = (jid, groupMetadata) => {
  if (!jid) return [];
  const variants = new Set();
  variants.add(jid);

  for (const v of buildComparableIds(jid)) variants.add(v);

  if (groupMetadata && Array.isArray(groupMetadata.participants)) {
    const isLid = jid.endsWith('@lid') || jid.endsWith('@hosted.lid');
    const matched = groupMetadata.participants.find(p => {
      if (!p) return false;
      const pId  = typeof p === 'string' ? p : (p.id  || p.jid || '');
      const pLid = typeof p === 'string' ? '' : (p.lid || '');
      return pId === jid || pLid === jid;
    });
    if (matched && typeof matched === 'object') {
      if (matched.id)  variants.add(matched.id);
      if (matched.lid) variants.add(matched.lid);
      const pn = matched.phoneNumber || matched.pn;
      if (pn) {
        const pnJid = pn.includes('@') ? pn : `${pn}@s.whatsapp.net`;
        variants.add(pnJid);
      }
    }
    // also try matching against bare user portion
    if (isLid || jid.includes('@')) {
      const bare = jid.split('@')[0].split(':')[0];
      const matched2 = groupMetadata.participants.find(p => {
        if (!p) return false;
        const pId  = typeof p === 'string' ? p : (p.id  || p.jid || '');
        const pLid = typeof p === 'string' ? '' : (p.lid || '');
        return pId.startsWith(bare + '@') || pLid.startsWith(bare + '@');
      });
      if (matched2 && typeof matched2 === 'object') {
        if (matched2.id)  variants.add(matched2.id);
        if (matched2.lid) variants.add(matched2.lid);
        const pn2 = matched2.phoneNumber || matched2.pn;
        if (pn2) variants.add(pn2.includes('@') ? pn2 : `${pn2}@s.whatsapp.net`);
      }
    }
  }

  return Array.from(variants).filter(Boolean);
};

/**
 * Try profilePictureUrl across every variant of a JID until one succeeds.
 * Returns { url, jid } on success, or throws the last error.
 */
const tryFetchProfilePictureUrl = async (sock, jid, groupMetadata) => {
  const variants = resolveTargetJidVariants(jid, groupMetadata);
  let lastErr;
  for (const v of variants) {
    try {
      const url = await sock.profilePictureUrl(v, 'image');
      if (url) return { url, jid: v };
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) throw lastErr;
  return { url: null, jid };
};

/**
 * Pretty display for an LID/JID — prefers phone number if known.
 */
const displayUserTag = (jid, groupMetadata) => {
  if (!jid) return '';
  if (jid.endsWith('@lid') && groupMetadata?.participants) {
    const matched = groupMetadata.participants.find(p => {
      if (!p || typeof p === 'string') return false;
      return p.id === jid || p.lid === jid;
    });
    if (matched) {
      const pn = matched.phoneNumber || matched.pn;
      if (pn) return pn.split('@')[0];
    }
  }
  return jid.split('@')[0];
};

// ── LID → Phone resolution (shared by antiforeign, vcf, kickall, etc.) ────────

/**
 * Returns the real phone number string (digits only) for any JID, or null.
 *
 * Resolution order:
 *   1. Plain phone-number JID → user field is already the number
 *   2. Baileys in-memory signalRepository.lidMapping (fastest, no I/O)
 *   3. lid-mapping-<user>_reverse.json on disk (fallback after decryption)
 */
const resolvePhone = async (sock, jid) => {
  if (!jid) return null;
  try {
    const decoded = jidDecode(jid);
    if (!decoded?.user) return null;

    const { user, server } = decoded;
    const isLid = server === 'lid' || server === 'hosted.lid';

    if (!isLid) return user.split(':')[0];

    // 1. Baileys in-memory LID store — pass the full JID, not just the user part
    try {
      const lidStore = sock?.signalRepository?.lidMapping;
      if (lidStore?.getPNForLID) {
        const pn = await lidStore.getPNForLID(jid);
        if (pn) {
          const pnUser = jidDecode(pn)?.user || String(pn).split('@')[0];
          return pnUser.split(':')[0];
        }
      }
    } catch (_) { /* fall through */ }

    // 2. Reverse-mapping file written by Baileys after decryption
    const sessionPath = path.join(__dirname, '..', config.sessionName || 'session');
    const mapFile = path.join(sessionPath, `lid-mapping-${user}_reverse.json`);
    if (fs.existsSync(mapFile)) {
      try {
        const raw = fs.readFileSync(mapFile, 'utf8').trim();
        if (raw) {
          const pn = JSON.parse(raw);
          if (pn) return String(pn).split(':')[0];
        }
      } catch (_) {}
    }

    return null;
  } catch (_) {
    return null;
  }
};

/**
 * Subscribes to presence for all LID participants to nudge WhatsApp into
 * pushing LID↔PN mapping data, then polls until all resolve or timeout.
 */
const preloadLidResolution = async (sock, participants, { maxWaitMs = 12000, intervalMs = 1500 } = {}) => {
  const lidParticipants = participants.filter(p => {
    const decoded = jidDecode(p.id);
    return decoded && (decoded.server === 'lid' || decoded.server === 'hosted.lid');
  });
  if (!lidParticipants.length) return { attempted: 0, resolved: 0 };

  await Promise.all(lidParticipants.map(async p => {
    try { await sock.presenceSubscribe(p.id); } catch (_) {}
  }));

  const start = Date.now();
  let resolvedCount = 0;

  while (Date.now() - start < maxWaitMs) {
    const results = await Promise.all(lidParticipants.map(p => resolvePhone(sock, p.id)));
    resolvedCount = results.filter(Boolean).length;
    if (resolvedCount === lidParticipants.length) break;
    await new Promise(r => setTimeout(r, intervalMs));
  }

  return { attempted: lidParticipants.length, resolved: resolvedCount };
};

/**
 * Resolves phone numbers for all participants, skipping the bot and (optionally) admins.
 * Uses the phoneNumber field from groupMetadata() first (Baileys v7+), then full LID resolution.
 */
const enrichParticipants = async (sock, participants, { skipAdmins = true } = {}) => {
  const botJid   = sock.user?.id || '';
  const botPhone = (await resolvePhone(sock, botJid)) || botJid.split('@')[0].split(':')[0];

  const resolved = await Promise.all(participants.map(async p => {
    let phone = null;
    if (p.phoneNumber) {
      const dec = jidDecode(p.phoneNumber);
      phone = dec?.user?.split(':')[0] || String(p.phoneNumber).split('@')[0].split(':')[0];
    }
    if (!phone) phone = await resolvePhone(sock, p.id);
    return { ...p, phone, isUnresolvableLid: !phone };
  }));

  return resolved.filter(p => {
    const pNum = p.phone || p.id.split('@')[0].split(':')[0];
    if (pNum === botPhone) return false;
    if (skipAdmins && p.admin) return false;
    return true;
  });
};

module.exports = {
  findParticipant,
  buildComparableIds,
  normalizeJidWithLid,
  getLidMappingValue,
  resolveTargetJidVariants,
  tryFetchProfilePictureUrl,
  displayUserTag,
  resolvePhone,
  preloadLidResolution,
  enrichParticipants,
};

