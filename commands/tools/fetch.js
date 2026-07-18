const axios = require('axios');
const config = require('../../config');

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

module.exports = {
    name: 'fetch',
    aliases: ['get', 'browse', 'request'],
    category: 'tools',
    description: 'Fetch/send a request to a URL using any HTTP method',
    usage: '.fetch [method] <url> [json body]\n' +
           'e.g. .fetch https://example.com\n' +
           '     .fetch POST https://api.example.com/x {"key":"value"}',

    async execute(sock, msg, args, extra) {
        try {
            await sock.sendMessage(extra.from, {
                react: { text: "🔍", key: msg.key }
            });

            if (!args.length) {
                return await sock.sendMessage(extra.from, {
                    text: "❌ Please provide a URL to fetch.\n\n" + module.exports.usage
                }, { quoted: msg });
            }

            // Optional leading HTTP method
            let method = 'GET';
            let rest = [...args];
            if (METHODS.includes(rest[0].toUpperCase())) {
                method = rest[0].toUpperCase();
                rest = rest.slice(1);
            }

            const url = rest.shift();
            if (!url) {
                return await sock.sendMessage(extra.from, {
                    text: "❌ Please provide a valid URL to fetch."
                }, { quoted: msg });
            }

            try {
                new URL(url);
            } catch (urlError) {
                return await sock.sendMessage(extra.from, {
                    text: "❌ Invalid URL format. Please provide a valid URL."
                }, { quoted: msg });
            }

            // Remaining args form the request body (POST/PUT/PATCH)
            const bodyText = rest.join(' ').trim();
            let data;
            let requestHeaders = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            };

            if (bodyText && ['POST', 'PUT', 'PATCH'].includes(method)) {
                try {
                    data = JSON.parse(bodyText);
                    requestHeaders['Content-Type'] = 'application/json';
                } catch {
                    data = bodyText;
                    requestHeaders['Content-Type'] = 'text/plain';
                }
            }

            const response = await axios({
                method,
                url,
                data,
                responseType: 'arraybuffer',
                timeout: 70000,
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
                validateStatus: () => true, // handle non-2xx ourselves
                headers: requestHeaders
            });

            const contentType = response.headers['content-type'] || '';
            const buffer = Buffer.from(response.data);
            const filename = url.split('/').pop()?.split('?')[0] || "file";

            if (response.status >= 400) {
                const preview = buffer.toString('utf8').slice(0, 1500);
                return await sock.sendMessage(extra.from, {
                    text: preview
                        ? "```\n" + preview + "\n```"
                        : `❌ ${response.status} — empty response body`
                }, { quoted: msg });
            }

            if (buffer.length > MAX_FILE_SIZE) {
                return await sock.sendMessage(extra.from, {
                    text: `❌ File is too large (${(buffer.length / (1024 * 1024)).toFixed(2)}MB). Maximum allowed size is ${MAX_FILE_SIZE / (1024 * 1024)}MB.`
                }, { quoted: msg });
            }

            if (contentType.includes('application/json')) {
                try {
                    const json = JSON.parse(buffer.toString());
                    const jsonString = JSON.stringify(json, null, 2);
                    return await sock.sendMessage(extra.from, {
                        text: "```json\n" + jsonString + "\n```"
                    }, { quoted: msg });
                } catch (parseError) {
                    return await sock.sendMessage(extra.from, {
                        text: buffer.toString()
                    }, { quoted: msg });
                }
            }

            if (contentType.includes('text/html') || contentType.includes('text/')) {
                return await sock.sendMessage(extra.from, {
                    text: buffer.toString()
                }, { quoted: msg });
            }

            if (contentType.includes('image')) {
                if (buffer.length > 16 * 1024 * 1024) {
                    return await sock.sendMessage(extra.from, {
                        document: buffer,
                        fileName: filename,
                        mimetype: contentType
                    }, { quoted: msg });
                }
                return await sock.sendMessage(extra.from, {
                    image: buffer
                }, { quoted: msg });
            }

            if (contentType.includes('video')) {
                if (buffer.length > 16 * 1024 * 1024) {
                    return await sock.sendMessage(extra.from, {
                        document: buffer,
                        fileName: filename,
                        mimetype: contentType,
                        caption: `📹 Video too large for inline display. Sent as document.`
                    }, { quoted: msg });
                }
                return await sock.sendMessage(extra.from, {
                    video: buffer
                }, { quoted: msg });
            }

            if (contentType.includes('audio')) {
                return await sock.sendMessage(extra.from, {
                    audio: buffer,
                    mimetype: contentType,
                    fileName: filename
                }, { quoted: msg });
            }

            if (contentType.includes('application/pdf')) {
                return await sock.sendMessage(extra.from, {
                    document: buffer,
                    mimetype: "application/pdf",
                    fileName: filename.endsWith('.pdf') ? filename : `${filename}.pdf`
                }, { quoted: msg });
            }

            if (contentType.includes('application')) {
                return await sock.sendMessage(extra.from, {
                    document: buffer,
                    mimetype: contentType,
                    fileName: filename
                }, { quoted: msg });
            }

            // No body / unknown type fallback
            if (buffer.length === 0) {
                return await sock.sendMessage(extra.from, {
                    text: `❌ ${response.status} — empty response body`
                }, { quoted: msg });
            }

            return await sock.sendMessage(extra.from, {
                document: buffer,
                fileName: filename,
                mimetype: contentType || 'application/octet-stream'
            }, { quoted: msg });

        } catch (error) {
            console.error('[fetch]', error.message);

            let errorMessage = "❌ Failed to fetch the URL. ";

            if (error.code === 'ECONNABORTED') {
                errorMessage += "Request timeout. The server took too long to respond.";
            } else if (error.response) {
                errorMessage += `Server responded with status: ${error.response.status}`;
            } else if (error.request) {
                errorMessage += "No response received from server.";
            } else {
                errorMessage += "Please check the URL and try again.";
            }

            await sock.sendMessage(extra.from, {
                text: errorMessage
            }, { quoted: msg });

            await sock.sendMessage(extra.from, {
                react: { text: '❌', key: msg.key }
            });
        }
    }
};
