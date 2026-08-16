'use strict';

/**
 * JID Helper Utilities for LID-aware matching.
 *
 * LID ↔ phone mappings are read from and written to SQLite lid_map. Runtime
 * resolution may also learn a mapping from Baileys or group metadata, then
 * persists it immediately for later commands/restarts.
 */

const { jidDecode, jidEncode } = require('@whiskeysockets/baileys');
const database = require('../database');

const lidMappingCache = new Map();

function jidUser(value) {
  if (!value) return null;
  const raw = String(value);
  try {
    const decoded = jidDecode(raw);
    if (decoded?.user) return decoded.user.split(':')[0];
  } catch (_) {}
  return raw.split(':')[0].split('@')[0] || null;
}

function jidServer(value) {
  try {
    const server = jidDecode(String(value || ''))?.server;
    return server === 'c.us' ? 's.whatsapp.net' : server || null;
  } catch (_) {
    return null;
  }
}

function isLidJid(value) {
  const server = jidServer(value);
  return server === 'lid' || server === 'hosted.lid';
}

function isPnJid(value) {
  const server = jidServer(value);
  return server === 's.whatsapp.net' || server === 'hosted';
}

function cacheKey(direction, user) {
  return `${direction}:${user}`;
}

function getLidMappingValue(user, direction) {
  const normalizedUser = jidUser(user);
  if (!normalizedUser || !['lidToPn', 'pnToLid'].includes(direction)) return null;

  const key = cacheKey(direction, normalizedUser);
  if (lidMappingCache.has(key)) return lidMappingCache.get(key);

  try {
    const value = database.getLidMap(direction, normalizedUser) || null;
    lidMappingCache.set(key, value);
    return value;
  } catch (_) {
    // The helper can be imported before database.ready; do not cache a startup
    // failure as a permanent missing mapping.
    return null;
  }
}

function rememberLidMapping(lidValue, pnValue) {
  const lidUser = jidUser(lidValue);
  const pnUser = jidUser(pnValue);
  if (!lidUser || !pnUser || lidUser === pnUser) return false;

  try {
    const knownPn = getLidMappingValue(lidUser, 'lidToPn');
    const knownLid = getLidMappingValue(pnUser, 'pnToLid');

    if (knownPn !== pnUser) database.saveLidMap('lidToPn', lidUser, pnUser);
    if (knownLid !== lidUser) database.saveLidMap('pnToLid', pnUser, lidUser);

    lidMappingCache.set(cacheKey('lidToPn', lidUser), pnUser);
    lidMappingCache.set(cacheKey('pnToLid', pnUser), lidUser);
    return true;
  } catch (_) {
    return false;
  }
}

function rememberParticipantLidMapping(participant) {
  if (!participant || typeof participant === 'string') return false;

  const jidValues = [participant.lid, participant.id, participant.userJid].filter(Boolean);
  const lid = jidValues.find(isLidJid);
  const pn = participant.phoneNumber || participant.pn || jidValues.find(isPnJid);
  return lid && pn ? rememberLidMapping(lid, pn) : false;
}

function normalizeJidWithLid(jid) {
  if (!jid) return jid;

  try {
    const decoded = jidDecode(jid);
    if (!decoded?.user) return `${String(jid).split(':')[0].split('@')[0]}@s.whatsapp.net`;

    let user = decoded.user.split(':')[0];
    let server = decoded.server === 'c.us' ? 's.whatsapp.net' : decoded.server;

    if (server === 'lid' || server === 'hosted.lid') {
      const pnUser = getLidMappingValue(user, 'lidToPn');
      if (pnUser) {
        user = pnUser;
        server = server === 'hosted.lid' ? 'hosted' : 's.whatsapp.net';
      }
    }

    return jidEncode(user, server === 'hosted' ? 'hosted' : 's.whatsapp.net');
  } catch (_) {
    return jid;
  }
}

function buildComparableIds(jid) {
  if (!jid) return [];

  try {
    const decoded = jidDecode(jid);
    if (!decoded?.user) return [normalizeJidWithLid(jid)].filter(Boolean);

    const user = decoded.user.split(':')[0];
    const server = decoded.server === 'c.us' ? 's.whatsapp.net' : decoded.server;
    const variants = new Set([jidEncode(user, server)]);

    if (server === 's.whatsapp.net' || server === 'hosted') {
      const lidUser = getLidMappingValue(user, 'pnToLid');
      if (lidUser) variants.add(jidEncode(lidUser, server === 'hosted' ? 'hosted.lid' : 'lid'));
    } else if (server === 'lid' || server === 'hosted.lid') {
      const pnUser = getLidMappingValue(user, 'lidToPn');
      if (pnUser) variants.add(jidEncode(pnUser, server === 'hosted.lid' ? 'hosted' : 's.whatsapp.net'));
    }

    return [...variants];
  } catch (_) {
    return [jid];
  }
}

function findParticipant(participants = [], userIds) {
  const targets = (Array.isArray(userIds) ? userIds : [userIds])
    .filter(Boolean)
    .flatMap(buildComparableIds);
  if (!targets.length) return null;

  return participants.find(participant => {
    if (!participant) return false;
    const participantIds = [participant.id, participant.lid, participant.userJid]
      .filter(Boolean)
      .flatMap(buildComparableIds);
    return participantIds.some(id => targets.includes(id));
  }) || null;
}

function resolveTargetJidVariants(jid, groupMetadata) {
  if (!jid) return [];
  const variants = new Set([jid]);
  for (const variant of buildComparableIds(jid)) variants.add(variant);

  if (Array.isArray(groupMetadata?.participants)) {
    const targetUser = jidUser(jid);
    const matched = groupMetadata.participants.find(participant => {
      if (!participant || typeof participant === 'string') return false;
      const ids = [participant.id, participant.lid, participant.userJid].filter(Boolean);
      return ids.includes(jid) || ids.some(value => jidUser(value) === targetUser);
    });
    if (matched) {
      rememberParticipantLidMapping(matched);
      for (const value of [matched.id, matched.lid, matched.userJid, matched.phoneNumber, matched.pn]) {
        if (!value) continue;
        variants.add(String(value).includes('@') ? value : `${value}@s.whatsapp.net`);
      }
      for (const variant of [matched.id, matched.lid, matched.userJid].filter(Boolean).flatMap(buildComparableIds)) {
        variants.add(variant);
      }
    }
  }

  return [...variants].filter(Boolean);
}

async function tryFetchProfilePictureUrl(sock, jid, groupMetadata) {
  const variants = resolveTargetJidVariants(jid, groupMetadata);
  let lastError;
  for (const variant of variants) {
    try {
      const url = await sock.profilePictureUrl(variant, 'image');
      if (url) return { url, jid: variant };
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return { url: null, jid };
}

function displayUserTag(jid, groupMetadata) {
  if (!jid) return '';
  if (Array.isArray(groupMetadata?.participants)) {
    const targetUser = jidUser(jid);
    const matched = groupMetadata.participants.find(participant => {
      if (!participant || typeof participant === 'string') return false;
      const ids = [participant.id, participant.lid, participant.userJid].filter(Boolean);
      return ids.includes(jid) || ids.some(value => jidUser(value) === targetUser);
    });
    if (matched) {
      rememberParticipantLidMapping(matched);
      const pn = matched.phoneNumber || matched.pn;
      if (pn) return jidUser(pn) || String(pn).split('@')[0];
    }
  }
  return String(jid).split('@')[0];
}

async function resolvePhone(sock, jid) {
  if (!jid) return null;

  try {
    const decoded = jidDecode(jid);
    if (!decoded?.user) return null;
    const user = decoded.user.split(':')[0];
    const server = decoded.server;
    const isLid = server === 'lid' || server === 'hosted.lid';
    if (!isLid) return user;

    // Baileys maintains a live LID map while connected. Persist any successful
    // live answer into SQLite so later commands/restarts do not need a file.
    try {
      const lidStore = sock?.signalRepository?.lidMapping;
      if (lidStore?.getPNForLID) {
        const pn = await lidStore.getPNForLID(jid);
        if (pn) {
          const pnUser = jidUser(pn);
          if (pnUser) {
            rememberLidMapping(user, pnUser);
            return pnUser;
          }
        }
      }
    } catch (_) {}

    return getLidMappingValue(user, 'lidToPn');
  } catch (_) {
    return null;
  }
}

async function preloadLidResolution(sock, participants, { maxWaitMs = 12_000, intervalMs = 1_500 } = {}) {
  const list = Array.isArray(participants) ? participants : [];
  for (const participant of list) rememberParticipantLidMapping(participant);

  const lidParticipants = list.filter(participant => {
    const id = participant?.id || participant;
    return isLidJid(id);
  });
  if (!lidParticipants.length) return { attempted: 0, resolved: 0 };

  await Promise.all(lidParticipants.map(async participant => {
    try { await sock.presenceSubscribe(participant.id || participant); } catch (_) {}
  }));

  const start = Date.now();
  let resolvedCount = 0;
  while (Date.now() - start < maxWaitMs) {
    const results = await Promise.all(lidParticipants.map(participant => resolvePhone(sock, participant.id || participant)));
    resolvedCount = results.filter(Boolean).length;
    if (resolvedCount === lidParticipants.length) break;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  return { attempted: lidParticipants.length, resolved: resolvedCount };
}

async function enrichParticipants(sock, participants, { skipAdmins = true } = {}) {
  const list = Array.isArray(participants) ? participants : [];
  const botJid = sock.user?.id || '';
  const botPhone = (await resolvePhone(sock, botJid)) || jidUser(botJid);

  const resolved = await Promise.all(list.map(async participant => {
    rememberParticipantLidMapping(participant);
    let phone = participant.phoneNumber ? jidUser(participant.phoneNumber) : null;
    if (!phone) phone = await resolvePhone(sock, participant.id);
    return { ...participant, phone, isUnresolvableLid: !phone };
  }));

  return resolved.filter(participant => {
    const number = participant.phone || jidUser(participant.id);
    if (number === botPhone) return false;
    if (skipAdmins && participant.admin) return false;
    return true;
  });
}

module.exports = {
  jidUser,
  getLidMappingValue,
  rememberLidMapping,
  rememberParticipantLidMapping,
  findParticipant,
  buildComparableIds,
  normalizeJidWithLid,
  resolveTargetJidVariants,
  tryFetchProfilePictureUrl,
  displayUserTag,
  resolvePhone,
  preloadLidResolution,
  enrichParticipants,
};
