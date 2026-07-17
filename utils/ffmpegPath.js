/**
 * Resolves the ffmpeg binary path.
 * Prefers explicit system paths over ffmpeg-static, whose pre-compiled
 * binary does not run on NixOS (Replit) or many container environments.
 */
const { execSync } = require('child_process');
const fs = require('fs');

const CANDIDATES = [
    // 1. Whatever `which ffmpeg` finds in PATH (works on Replit, most Linux)
    (() => { try { return execSync('which ffmpeg', { encoding: 'utf8' }).trim(); } catch { return null; } })(),
    // 2. Common system locations
    '/usr/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    // 3. ffmpeg-static package path (only if the binary actually exists)
    (() => { try { const p = require('ffmpeg-static'); return (p && fs.existsSync(p)) ? p : null; } catch { return null; } })(),
    // 4. Bare command name — last resort (relies on PATH at spawn time)
    'ffmpeg',
];

const resolved = CANDIDATES.find(p => {
    if (!p) return false;
    if (p === 'ffmpeg') return true;          // bare name, always accept
    return fs.existsSync(p);                  // explicit path must exist
}) || 'ffmpeg';

module.exports = resolved;
