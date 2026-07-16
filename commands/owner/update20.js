/**
 * Update Command – Clean update from Vercel Relay (Owner Only)
 *
 * Flow: Download ZIP from Vercel → Extract → Replace files → Restart
 * Preserved: node_modules, session, tmp, temp, database, config.js, .env, .env.local
 */

const { exec } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const axios  = require('axios');
const config = require('../../config');

// ── Vercel relay configuration (matches bootloader) ─────────────────────────
const VERCEL_RELAY_URL = process.env.VERCEL_RELAY_URL || 'https://june-vercel.vercel.app/api/repo';
const ACCESS_KEY       = process.env.ACCESS_KEY       || 'j-41-183-184';

// Files / folders that must survive the update
const PRESERVED = new Set([
    'node_modules', '.git', 'session', 'tmp', 'temp',
    'database', 'config.js', '.env', '.env.local',
]);

// ── Platform helper ──────────────────────────────────────────────────────────

const detectPlatform = () => {
    if (process.env.DYNO)                                               return 'Heroku';
    if (process.env.RENDER)                                             return 'Render';
    if (process.env.REPLIT_SLUG || process.env.REPL_ID)                 return 'Replit';
    if (process.env.PREFIX && process.env.PREFIX.includes('termux'))    return 'Termux';
    if (process.env.PORTS && process.env.CYPHERX_HOST_ID)               return 'CypherX';
    if (process.env.P_SERVER_UUID)                                      return 'Panel';
    if (process.env.LXC)                                                return 'LXC';
    switch (os.platform()) {
        case 'win32':  return 'Windows';
        case 'darwin': return 'macOS';
        case 'linux':  return 'Linux';
        default:       return 'Unknown';
    }
};

// ── Core helpers ──────────────────────────────────────────────────────────────

function run(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, { windowsHide: true }, (err, stdout, stderr) => {
            if (err) return reject(new Error((stderr || stdout || err.message || '').toString().trim()));
            resolve((stdout || '').toString().trim());
        });
    });
}

/**
 * Extract ZIP archive. Tries adm-zip first, then falls back to system unzip tools.
 */
async function extractZip(zipPath, outDir) {
    fs.mkdirSync(outDir, { recursive: true });

    let admZipAvailable = false;
    try {
        const AdmZip = require('adm-zip');
        admZipAvailable = true;
        const zip = new AdmZip(zipPath);
        zip.extractAllTo(outDir, true);
        return;
    } catch (err) {
        if (!admZipAvailable) {
            try {
                await run('npm install adm-zip');
                const AdmZip = require('adm-zip');
                const zip = new AdmZip(zipPath);
                zip.extractAllTo(outDir, true);
                return;
            } catch (installErr) {
                // fall through to system tools
            }
        }
    }

    if (process.platform === 'win32') {
        await run(`powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${outDir.replace(/\\/g, '/')}' -Force"`);
        return;
    }
    for (const [check, cmd] of [
        ['unzip',         `unzip -o "${zipPath}" -d "${outDir}"`],
        ['7z',            `7z x -y "${zipPath}" -o"${outDir}"`],
        ['busybox unzip', `busybox unzip -o "${zipPath}" -d "${outDir}"`],
    ]) {
        try {
            await run(`command -v ${check.split(' ')[0]}`);
            await run(cmd);
            return;
        } catch { /* try next tool */ }
    }
    throw new Error('No unzip tool found. Install unzip/7z or ensure adm-zip is available.');
}

/**
 * Download the repository ZIP from the Vercel relay.
 */
async function downloadVercelZip(dest) {
    const response = await axios.get(VERCEL_RELAY_URL, {
        responseType: 'arraybuffer',
        headers: {
            'x-access-key': ACCESS_KEY,
            'User-Agent':   'supreme-bot-updater',
        },
        timeout: 30000,
    });
    fs.writeFileSync(dest, Buffer.from(response.data));
}

function cleanDirectory(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir)) {
        if (PRESERVED.has(entry)) continue;
        try {
            fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
        } catch (e) { /* file might be locked or already gone */ }
    }
}

function copyRecursive(src, dest, isRoot = false, outList = []) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
        if (isRoot && PRESERVED.has(entry)) continue;
        const s = path.join(src, entry);
        const d = path.join(dest, entry);
        if (fs.lstatSync(s).isDirectory()) {
            copyRecursive(s, d, false, outList);
        } else {
            fs.copyFileSync(s, d);
            outList.push(path.relative(dest, d).replace(/\\/g, '/'));
        }
    }
}

// ── Command ───────────────────────────────────────────────────────────────────

module.exports = {
    name: 'update',
    aliases: ['start'],
    category: 'owner',
    description: 'Clean-update bot from Vercel relay (Owner Only)',
    usage: '.update',
    ownerOnly: true,

    async execute(sock, msg, args, extra) {
        const chatId  = msg.key.remoteJid;
        const botRoot = path.join(__dirname, '..', '..');
        const platform = detectPlatform();

        let statusKey = null;
        const editStatus = async (text) => {
            try {
                if (statusKey) await sock.sendMessage(chatId, { edit: statusKey, text });
            } catch (_) { /* ignore edit errors */ }
        };

        try {
            const sent = await sock.sendMessage(chatId, { text: '🔄 Update: connecting...' }, { quoted: msg });
            statusKey = sent?.key;

            await editStatus('🔄 Update: downloading...');

            const tmpDir    = path.join(botRoot, 'tmp');
            const zipPath   = path.join(tmpDir, 'update.zip');
            const extractTo = path.join(tmpDir, 'extract');
            fs.mkdirSync(tmpDir, { recursive: true });

            await downloadVercelZip(zipPath);

            await editStatus('🔄 Update: extracting...');
            if (fs.existsSync(extractTo)) fs.rmSync(extractTo, { recursive: true, force: true });
            await extractZip(zipPath, extractTo);

            const entries = fs.readdirSync(extractTo);
            if (entries.length === 0) {
                throw new Error('Extracted archive is empty – aborting update.');
            }

            await editStatus('🔄 Update: applying files...');
            const inner = entries.length === 1 && fs.lstatSync(path.join(extractTo, entries[0])).isDirectory()
                ? path.join(extractTo, entries[0])
                : extractTo;

            cleanDirectory(botRoot);
            const copied = [];
            copyRecursive(inner, botRoot, true, copied);

            try { fs.rmSync(extractTo, { recursive: true, force: true }); } catch { }
            try { fs.rmSync(zipPath,   { force: true });                  } catch { }

            await editStatus(`✅ Update complete — ${copied.length} files. Restarting...`);

            try { await run('pm2 restart all'); return; } catch { }
            setTimeout(() => process.exit(0), 800);

        } catch (error) {
            let sanitizedError = String(error.message || error);
            sanitizedError = sanitizedError.replace(new RegExp(VERCEL_RELAY_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '[REDACTED_URL]');
            sanitizedError = sanitizedError.replace(new RegExp(ACCESS_KEY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '[REDACTED_KEY]');

            await editStatus(`❌ Update failed (${platform}): ${sanitizedError}`);
        }
    }
};
