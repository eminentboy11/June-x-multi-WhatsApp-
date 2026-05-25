/**
 * APK Downloader - Search and download APKs from Aptoide
 */

const axios = require('axios');
const { applyFont } = require('../../utils/fontConverter');
const config = require('../../config');

// Per-chat rate limiting
const downloadRequests = new Map();
const COOLDOWN_MS = 5000;

module.exports = {
    name: 'apk',
    aliases: ['apksearch', 'apkdl'],
    category: 'general',
    description: 'Search and download an APK by app name',
    usage: '.apk <app name>',

    async execute(sock, msg, args, extra) {
        const chatId = extra.from;
        const query  = args.join(' ').trim();

        try {
            if (!query) {
                return await sock.sendMessage(chatId, {
                    text: applyFont(
                        `┏━━『 APK DOWNLOADER 』━━\n\n` +
                        `➥ Usage   ➜ .apk <app name>\n` +
                        `➥ Example ➜ .apk Instagram\n\n` +
                        `┗━━━━━━━━━━━━━━━━`
                    )
                }, { quoted: msg });
            }

            if (query.length < 2) {
                return await sock.sendMessage(chatId, {
                    text: applyFont(
                        `┏━━『 ERROR 』━━\n\n` +
                        `➥ Reason ➜ Query too short\n` +
                        `➥ Tip    ➜ Provide at least 2 characters\n\n` +
                        `┗━━━━━━━━━━━━━━━━`
                    )
                }, { quoted: msg });
            }

            // ── Rate limiting ─────────────────────────────────────────────────
            const lastRequest = downloadRequests.get(chatId);
            if (lastRequest) {
                const timeDiff = Date.now() - lastRequest;
                if (timeDiff < COOLDOWN_MS) {
                    return await sock.sendMessage(chatId, {
                        text: applyFont(
                            `┏━━『 COOLDOWN 』━━\n\n` +
                            `➥ Please wait ➜ ${Math.ceil((COOLDOWN_MS - timeDiff) / 1000)}s\n\n` +
                            `┗━━━━━━━━━━━━━━━━`
                        )
                    }, { quoted: msg });
                }
            }
            downloadRequests.set(chatId, Date.now());

            await sock.sendMessage(chatId, { react: { text: '🔍', key: msg.key } });

            // ── Search Aptoide ────────────────────────────────────────────────
            const apiUrl = `http://ws75.aptoide.com/api/7/apps/search/query=${encodeURIComponent(query)}/limit=10`;

            const response = await axios.get(apiUrl, {
                timeout: 30000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            const data = response.data;

            if (!data?.datalist?.list?.length) {
                return await sock.sendMessage(chatId, {
                    text: applyFont(
                        `┏━━『 NOT FOUND 』━━\n\n` +
                        `➥ Query  ➜ ${query}\n` +
                        `➥ Tip 1  ➜ Check spelling\n` +
                        `➥ Tip 2  ➜ Try different keywords\n` +
                        `➥ Tip 3  ➜ App may not be available\n\n` +
                        `┗━━━━━━━━━━━━━━━━`
                    )
                }, { quoted: msg });
            }

            const app = data.datalist.list[0];

            if (!app.file?.path_alt) {
                return await sock.sendMessage(chatId, {
                    text: applyFont(
                        `┏━━『 ERROR 』━━\n\n` +
                        `➥ Reason ➜ Download link not available\n\n` +
                        `┗━━━━━━━━━━━━━━━━`
                    )
                }, { quoted: msg });
            }

            const sizeMB    = app.size ? (app.size / (1024 * 1024)).toFixed(2) : 'Unknown';
            const downloads = app.downloads ? app.downloads.toLocaleString() : 'Unknown';
            const rating    = app.rating ? Number(app.rating).toFixed(1) : 'N/A';
            const version   = app.vername || app.vercode || 'Unknown';
            const fileName  = `${(app.name || 'app').replace(/[^a-zA-Z0-9]/g, '_')}.apk`;

            await sock.sendMessage(chatId, { react: { text: '⬇️', key: msg.key } });

            // ── Check file size before downloading ────────────────────────────
            try {
                const headResponse  = await axios.head(app.file.path_alt, { timeout: 10000 });
                const contentLength = headResponse.headers['content-length'];
                if (contentLength && parseInt(contentLength) > 100 * 1024 * 1024) {
                    return await sock.sendMessage(chatId, {
                        text: applyFont(
                            `┏━━『 ERROR 』━━\n\n` +
                            `➥ Reason ➜ File exceeds 100MB limit\n` +
                            `➥ Size   ➜ ${sizeMB} MB\n\n` +
                            `┗━━━━━━━━━━━━━━━━`
                        )
                    }, { quoted: msg });
                }
            } catch {
                // Can't verify size — proceed anyway
            }

            await sock.sendMessage(chatId, { react: { text: '⬆️', key: msg.key } });

            // ── Send APK as plain document — no caption ───────────────────────
            await sock.sendMessage(chatId, {
                document: { url: app.file.path_alt },
                fileName: fileName,
                mimetype: 'application/vnd.android.package-archive',
            }, { quoted: msg });

            await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });
            console.log(`[apk] downloaded: ${app.name} for query: ${query}`);

        } catch (error) {
            console.error('[apk] error:', error);
            downloadRequests.delete(chatId);

            let reason = 'An error occurred while processing your request.';
            if (error.code === 'ECONNABORTED')        reason = 'Request timed out. Try again later.';
            else if (error.response?.status === 404)  reason = 'API endpoint not found. Service may be down.';
            else if (error.response?.status >= 500)   reason = 'Server error. Try again later.';
            else if (error.code === 'ENOTFOUND')      reason = 'Network error. Check your connection.';

            await sock.sendMessage(chatId, {
                text: applyFont(
                    `┏━━『 ERROR 』━━\n\n` +
                    `➥ Reason ➜ ${reason}\n\n` +
                    `┗━━━━━━━━━━━━━━━━`
                )
            }, { quoted: msg });
            await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } });
        }
    }
};
