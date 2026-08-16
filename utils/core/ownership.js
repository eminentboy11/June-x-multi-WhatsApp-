/**
 * Ownership — deployment-level Super Owner foundation.
 *
 * SECURITY MODEL
 * --------------
 * - The deployment Super Owner is established ONCE, during first-time
 *   initialization, from the verified WhatsApp number of the FIRST initial
 *   session that successfully connects (never from .addbot, never from a
 *   WhatsApp command, never from hardcoded config).
 * - Once persisted it is LOCKED: it is never recalculated on startup, never
 *   overwritten, and never cleared by disconnects, removals or reordering.
 * - Platform-level commands (superOwnerOnly) resolve ONLY against the
 *   persisted Super Owner. Until it is established, the legacy
 *   config.ownerNumber list acts as a bootstrap authority so a fresh
 *   deployment can still be operated before the first connection.
 * - Session-level ownership (ownerOnly / config.ownerNumber) remains a
 *   separate concept; `isOwner` is the union of both so the Super Owner can
 *   always operate the whole deployment.
 *
 * Storage: platform_settings table in the ANCHOR database (june-ultra.db) —
 * deployment-level, independent of the session registry.
 */

'use strict';

const database = require('../../database');
const config = require('../../config');

const SUPER_OWNER_KEY = 'superOwner';

const normalizeNumber = (value) =>
    String(value || '').split(':')[0].split('@')[0].replace(/\D/g, '');

function getSuperOwner() {
    try {
        return database.getPlatformSetting(SUPER_OWNER_KEY) || null;
    } catch (_) {
        return null;
    }
}

function hasSuperOwner() {
    return Boolean(getSuperOwner());
}

function sessionMatchesSuperOwner(sessionNumber, superOwner) {
    const session = normalizeNumber(sessionNumber);
    const owner = normalizeNumber(superOwner);
    return Boolean(session && owner && session === owner);
}

/**
 * Does this sender match the persisted deployment Super Owner?
 * (false whenever no Super Owner has been established yet)
 */
function isSuperOwner(sender) {
    const superOwner = getSuperOwner();
    if (!superOwner) return false;
    return normalizeNumber(sender) === normalizeNumber(superOwner);
}

/**
 * Platform-level authority check (superOwnerOnly commands):
 *   - Super Owner established  -> ONLY the persisted Super Owner passes.
 *   - Not yet established       -> the legacy config.ownerNumber list passes
 *     (bootstrap window for fresh deployments).
 */
function isPlatformOwner(sender) {
    if (hasSuperOwner()) return isSuperOwner(sender);
    try {
        const list = config.ownerNumber || [];
        const num = normalizeNumber(sender);
        return Array.isArray(list) && list.some((o) => normalizeNumber(o) === num);
    } catch (_) {
        return false;
    }
}

/**
 * Platform authority for a specific bot session.
 *
 * A deployment Super Owner may control the fleet, but platform commands must
 * execute only on the session that established that deployment ownership.
 * Without this second check, every connected bot sees the same Super Owner
 * sender and replies to the same management command.
 *
 * During the pre-establishment bootstrap window, preserve the legacy
 * config.ownerNumber fallback. Once ownership is persisted, both the sender
 * and the current bot session must match it.
 */
function isPlatformOwnerForSession(sender, sessionNumber) {
    if (!isPlatformOwner(sender)) return false;
    const persisted = getSuperOwner();
    if (!persisted) return true;
    return sessionMatchesSuperOwner(sessionNumber, persisted);
}

/**
 * Atomically establish the deployment Super Owner from a session's verified
 * WhatsApp number. Only eligible initial sessions may claim; the underlying
 * SQLite INSERT ... ON CONFLICT DO NOTHING makes the first writer win and
 * every later claim a no-op — race-safe even when multiple initial sessions
 * connect nearly simultaneously.
 *
 * @param {string|number} number  verified WhatsApp number (sock.user.id)
 * @param {boolean} eligible      true only for initial-startup sessions
 * @returns {{ established: boolean, existing: string|null, superOwner: string|null }}
 */
function claimSuperOwner(number, { eligible = false } = {}) {
    const existing = getSuperOwner();
    if (existing) return { established: false, existing, superOwner: existing };
    if (!eligible) return { established: false, existing: null, superOwner: null };
    const normalized = normalizeNumber(number);
    if (!normalized) return { established: false, existing: null, superOwner: null };

    const result = database.claimPlatformSetting(SUPER_OWNER_KEY, normalized);
    return {
        established: result.established,
        existing: result.existing || null,
        superOwner: result.existing || null,
    };
}

/**
 * Display-only indicator for the connected/welcome message:
 *   '✅' current session IS the Super Owner
 *   '❌' a Super Owner exists and this session is not it
 *   '—' no Super Owner established yet
 * The Super Owner number itself is never returned or printed.
 */
function superOwnerStatusFor(number) {
    const superOwner = getSuperOwner();
    if (!superOwner) return '—';
    return normalizeNumber(number) === normalizeNumber(superOwner) ? '✅' : '❌';
}

module.exports = {
    SUPER_OWNER_KEY,
    normalizeNumber,
    getSuperOwner,
    hasSuperOwner,
    sessionMatchesSuperOwner,
    isSuperOwner,
    isPlatformOwner,
    isPlatformOwnerForSession,
    claimSuperOwner,
    superOwnerStatusFor,
};
