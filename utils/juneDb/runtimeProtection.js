'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

function atomicWriteFile(filePath, data, options = 'utf8') {
  const target = path.resolve(filePath);
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(temp, data, options);
    fs.renameSync(temp, target);
  } finally {
    try { fs.rmSync(temp, { force: true }); } catch (_) {}
  }
}

function boundedMap(map, maxEntries) {
  if (!(map instanceof Map) || map.size <= maxEntries) return;
  while (map.size > maxEntries) {
    map.delete(map.keys().next().value);
  }
}

function pruneMap(map, maxAgeMs, now = Date.now()) {
  if (!(map instanceof Map)) return;
  for (const [key, value] of map) {
    const timestamp = value?.timestamp ?? value?.ts ?? value?.updatedAt ?? 0;
    if (timestamp && now - timestamp > maxAgeMs) map.delete(key);
  }
}

function directorySize(dirPath) {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      const full = path.join(dirPath, entry.name);
      try {
        total += entry.isDirectory() ? directorySize(full) : fs.statSync(full).size;
      } catch (_) {}
    }
  } catch (_) {}
  return total;
}

function diskFreeBytes(targetPath = process.cwd()) {
  try {
    if (typeof fs.statfsSync === 'function') {
      const stats = fs.statfsSync(targetPath);
      return Number(stats.bavail) * Number(stats.bsize);
    }
  } catch (_) {}
  return null;
}

function createDiskManager(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const minimumFreeBytes = Number(options.minimumFreeBytes) ||
    (Number(process.env.JUNE_MIN_FREE_MB) || 100) * 1024 * 1024;
  const intervalMs = Number(options.intervalMs) ||
    (Number(process.env.JUNE_DISK_CHECK_MS) || 5 * 60 * 1000);
  const cleanup = typeof options.cleanup === 'function' ? options.cleanup : () => {};
  const cleanupCooldownMs = Number(options.cleanupCooldownMs) ||
    (Number(process.env.JUNE_DISK_CLEANUP_COOLDOWN_MS) || 15 * 60 * 1000);
  let timer = null;
  let last = { freeBytes: null, low: false, checkedAt: null, cleanupAt: null };
  let running = false;

  const check = (force = false) => {
    const now = Date.now();
    const freeBytes = diskFreeBytes(root);
    const low = freeBytes !== null && freeBytes < minimumFreeBytes;
    const becameLow = low && !last.low;
    const cleanupDue = low && (
      force ||
      becameLow ||
      !last.cleanupAt ||
      now - last.cleanupAt >= cleanupCooldownMs
    );
    last = { ...last, freeBytes, low, checkedAt: now };
    if (cleanupDue) {
      try {
        const result = cleanup({ aggressive: true, freeBytes, minimumFreeBytes });
        // Cleanup is allowed to be async without making disk checks block.
        Promise.resolve(result).catch(() => {});
        last.cleanupAt = now;
      } catch (_) {}
    }
    return last;
  };

  return {
    start() {
      if (running) return;
      running = true;
      check();
      timer = setInterval(() => check(), intervalMs);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      running = false;
    },
    check,
    emergencyCleanup() { return check(true); },
    getStatus() { return { ...last, minimumFreeBytes, cleanupCooldownMs, root }; },
    getReport() {
      return {
        ...this.getStatus(),
        rootBytes: directorySize(root),
        tmpBytes: directorySize(os.tmpdir()),
      };
    },
  };
}

function createTelemetryStore(options = {}) {
  const maxEntries = Number(options.maxEntries) || 500;
  const events = [];
  const record = (type, data = {}) => {
    events.push({ type, data, timestamp: Date.now() });
    if (events.length > maxEntries) events.splice(0, events.length - maxEntries);
  };
  return {
    record,
    list(limit = 50) { return events.slice(-Math.max(0, Number(limit) || 0)); },
    stats() {
      const counts = {};
      for (const event of events) counts[event.type] = (counts[event.type] || 0) + 1;
      return { total: events.length, counts, last: events.at(-1) || null };
    },
  };
}

module.exports = {
  atomicWriteFile,
  boundedMap,
  pruneMap,
  directorySize,
  diskFreeBytes,
  createDiskManager,
  createTelemetryStore,
};