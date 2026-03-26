/**
 * APK Downloader - Search and download APKs from Aptoide
 */

const axios = require('axios');

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
        const query = args.join(' ').trim();

        try {
            if (!query) {
                return await sock.sendMessage(chatId, {
                    text: `*🔍 Please provide an app name to search.*\n\n_Usage:_\n.apk Instagram\n\n_Example:_\n.apk WhatsApp`
                }, { quoted: msg });
            }

            if (query.length < 2) {
                return await sock.sendMessage(chatId, {
                    text: '❌ *Query too short.* Please provide at least 2 characters.'
                }, { quoted: msg });
            }

            // Rate limiting
            const lastRequest = downloadRequests.get(chatId);
            if (lastRequest) {
                const timeDiff = Date.now() - lastRequest;
                if (timeDiff < COOLDOWN_MS) {
                    return await sock.sendMessage(chatId, {
                        text: `⏳ *Please wait* ${Math.ceil((COOLDOWN_MS - timeDiff) / 1000)} seconds before making another request.`
                    }, { quoted: msg });
                }
            }
            downloadRequests.set(chatId, Date.now());

            await sock.sendMessage(chatId, { react: { text: '🔍', key: msg.key } });

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
                    text: `❌ *No APK found for* "${query}"\n\n💡 *Suggestions:*\n• Check spelling\n• Try different keywords\n• App might not be available`
                }, { quoted: msg });
            }

            const app = data.datalist.list[0];

            if (!app.file?.path_alt) {
                return await sock.sendMessage(chatId, {
                    text: '❌ *Download link not available* for this app.'
                }, { quoted: msg });
            }

            const sizeMB = app.size ? (app.size / (1024 * 1024)).toFixed(2) : 'Unknown';
            const downloads = app.downloads ? app.downloads.toLocaleString() : 'Unknown';
            const rating = app.rating ? Number(app.rating).toFixed(1) : 'Not rated';

            const caption = `🎮 *${app.name || 'Unknown App'}*

📦 *Package:* \`${app.package || 'N/A'}\`
⭐ *Rating:* ${rating}/5
📥 *Downloads:* ${downloads}
📅 *Last Updated:* ${app.updated || 'Unknown'}
📁 *Size:* ${sizeMB} MB
🏷️ *Version:* ${app.vercode || app.vername || 'Unknown'}

🔒 *Use at your own risk. Always verify APK sources.*`.trim();

            await sock.sendMessage(chatId, { react: { text: '⬇️', key: msg.key } });

            // Check file size before sending
            try {
                const headResponse = await axios.head(app.file.path_alt, { timeout: 10000 });
                const contentLength = headResponse.headers['content-length'];
                if (contentLength && parseInt(contentLength) > 100 * 1024 * 1024) {
                    return await sock.sendMessage(chatId, {
                        text: '❌ *File too large.* APK exceeds 100MB limit.'
                    }, { quoted: msg });
                }
            } catch {
                // Can't verify size — proceed anyway
            }

            await sock.sendMessage(chatId, { react: { text: '⬆️', key: msg.key } });

            await sock.sendMessage(chatId, {
                document: { url: app.file.path_alt },
                fileName: `${(app.name || 'app').replace(/[^a-zA-Z0-9]/g, '_')}.apk`,
                mimetype: 'application/vnd.android.package-archive',
                caption: caption,
                contextInfo: {
                    externalAdReply: {
                        title: app.name || 'APK Download',
                        body: `Rating: ${rating} | Size: ${sizeMB}MB`,
                        mediaType: 1,
                        thumbnailUrl: app.icon || '',
                        sourceUrl: app.file.path_alt,
                        renderLargerThumbnail: true,
                        showAdAttribution: false
                    }
                }
            }, { quoted: msg });

            await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });
            console.log(`APK downloaded: ${app.name} for query: ${query}`);

        } catch (error) {
            console.error('APK Download Error:', error);
            downloadRequests.delete(chatId);

            let errorMessage = '❌ *An error occurred while processing your request.*';
            if (error.code === 'ECONNABORTED') {
                errorMessage = '⏰ *Request timeout.* Please try again later.';
            } else if (error.response?.status === 404) {
                errorMessage = '🔍 *API endpoint not found.* Service might be unavailable.';
            } else if (error.response?.status >= 500) {
                errorMessage = '🔧 *Server error.* Please try again later.';
            } else if (error.code === 'ENOTFOUND') {
                errorMessage = '🌐 *Network error.* Please check your connection.';
            }

            await sock.sendMessage(chatId, { text: errorMessage }, { quoted: msg });
            await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } });
        }
    }
};
