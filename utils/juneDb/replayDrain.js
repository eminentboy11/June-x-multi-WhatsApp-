'use strict';

/**
 * Reconnect replay drain for Baileys.
 *
 * WhatsApp may replay a large backlog immediately after a socket reconnect.
 * During a short drain window, only old messages are dropped; fresh messages
 * always pass. This prevents stale replay traffic from blocking live commands.
 */

const INITIAL_DRAIN_MS = Math.max(10_000, Number(process.env.JUNE_REPLAY_DRAIN_MS) || 45_000);
const MAX_DRAIN_MS = Math.max(INITIAL_DRAIN_MS, Number(process.env.JUNE_REPLAY_DRAIN_MAX_MS) || 180_000);
const OLD_MESSAGE_MS = Math.max(5_000, Number(process.env.JUNE_REPLAY_AGE_MS) || 30_000);
const BURST_THRESHOLD = Math.max(5, Number(process.env.JUNE_REPLAY_BURST_THRESHOLD) || 15);
const BURST_EXTENSION_MS = Math.max(1_000, Number(process.env.JUNE_REPLAY_EXTENSION_MS) || 8_000);
const QUIET_WINDOWS_REQUIRED = Math.max(1, Number(process.env.JUNE_REPLAY_QUIET_WINDOWS) || 3);

let active = false;
let openedAt = 0;
let drainEndsAt = 0;
let hardCapAt = 0;
let burstWindowAt = 0;
let burstCount = 0;
let quietWindows = 0;
let dropped = 0;
let passed = 0;

function messageTimestampMs(message) {
  const raw = message?.messageTimestamp;
  if (!raw) return 0;
  const seconds = typeof raw === 'object' ? Number(raw.low || 0) : Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
}

function markConnectionOpen() {
  const now = Date.now();
  active = true;
  openedAt = now;
  drainEndsAt = now + INITIAL_DRAIN_MS;
  hardCapAt = now + MAX_DRAIN_MS;
  burstWindowAt = now;
  burstCount = 0;
  quietWindows = 0;
  dropped = 0;
  passed = 0;
}

function finishDrain() {
  active = false;
}

function isReplayMessage(message) {
  if (!active) return false;
  const now = Date.now();
  if (now >= drainEndsAt || now >= hardCapAt) {
    finishDrain();
    return false;
  }

  const timestamp = messageTimestampMs(message);
  if (!timestamp) return false;
  const age = now - timestamp;
  if (age <= OLD_MESSAGE_MS) {
    passed += 1;
    quietWindows = 0;
    return false;
  }

  if (now - burstWindowAt >= 1000) {
    if (burstCount >= BURST_THRESHOLD) {
      drainEndsAt = Math.min(hardCapAt, Math.max(drainEndsAt, now + BURST_EXTENSION_MS));
      quietWindows = 0;
    } else {
      quietWindows += 1;
      if (quietWindows >= QUIET_WINDOWS_REQUIRED) {
        finishDrain();
        return true;
      }
    }
    burstWindowAt = now;
    burstCount = 0;
  }

  burstCount += 1;
  dropped += 1;
  return true;
}

function getStats() {
  const now = Date.now();
  const effectiveEnd = Math.min(drainEndsAt, hardCapAt);
  return {
    active: active && now < effectiveEnd,
    openedAt,
    remainingMs: active ? Math.max(0, effectiveEnd - now) : 0,
    dropped,
    passed,
    initialDrainMs: INITIAL_DRAIN_MS,
    maxDrainMs: MAX_DRAIN_MS,
  };
}

module.exports = {
  markConnectionOpen,
  isReplayMessage,
  getStats,
};
