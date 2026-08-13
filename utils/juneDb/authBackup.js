'use strict';

/**
 * Encrypted remote backup envelope for Baileys auth state.
 *
 * The external database receives only AES-256-GCM ciphertext. The encryption
 * key lives only in JUNE_AUTH_BACKUP_KEY on the deployment platform.
 */

const crypto = require('crypto');
const zlib = require('zlib');

const KEY_ENV = 'JUNE_AUTH_BACKUP_KEY';
const ALGORITHM = 'aes-256-gcm';
const VERSION = 1;

function decodeKey(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;

  try {
    if (/^[a-f0-9]{64}$/i.test(value)) {
      const key = Buffer.from(value, 'hex');
      return key.length === 32 ? key : null;
    }

    const key = Buffer.from(value, 'base64');
    return key.length === 32 ? key : null;
  } catch (_) {
    return null;
  }
}

function getKey() {
  return decodeKey(process.env[KEY_ENV]);
}

function isConfigured() {
  return Boolean(getKey());
}

function getStatus() {
  return {
    configured: isConfigured(),
    keyEnvironment: KEY_ENV,
    algorithm: ALGORITHM,
    version: VERSION,
  };
}

function encryptSnapshot(snapshot) {
  const key = getKey();
  if (!key) throw new Error('AUTH_BACKUP_KEY_UNAVAILABLE');

  const plaintext = zlib.gzipSync(Buffer.from(JSON.stringify(snapshot), 'utf8'));
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    version: VERSION,
    algorithm: ALGORITHM,
    encoding: 'gzip-json',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    createdAt: Date.now(),
  };
}

function decryptSnapshot(envelope) {
  const key = getKey();
  if (!key) throw new Error('AUTH_BACKUP_KEY_UNAVAILABLE');
  if (!envelope || envelope.version !== VERSION || envelope.algorithm !== ALGORITHM) {
    throw new Error('AUTH_BACKUP_ENVELOPE_INVALID');
  }

  try {
    const iv = Buffer.from(String(envelope.iv || ''), 'base64');
    const tag = Buffer.from(String(envelope.tag || ''), 'base64');
    const ciphertext = Buffer.from(String(envelope.ciphertext || ''), 'base64');
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
      throw new Error('AUTH_BACKUP_ENVELOPE_INVALID');
    }

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const plaintext = envelope.encoding === 'gzip-json'
      ? zlib.gunzipSync(compressed)
      : compressed;
    const snapshot = JSON.parse(plaintext.toString('utf8'));
    if (!snapshot || typeof snapshot !== 'object') throw new Error('AUTH_BACKUP_SNAPSHOT_INVALID');
    return snapshot;
  } catch (error) {
    if (String(error.message || '').startsWith('AUTH_BACKUP_')) throw error;
    throw new Error('AUTH_BACKUP_DECRYPT_FAILED');
  }
}

module.exports = {
  KEY_ENV,
  ALGORITHM,
  VERSION,
  isConfigured,
  getStatus,
  encryptSnapshot,
  decryptSnapshot,
};
