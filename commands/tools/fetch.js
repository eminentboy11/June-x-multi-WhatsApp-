const axios = require('axios');
const config = require(require('path').join(global.__ROOT__, 'config'));

module.exports = {
    name: 'fetch',
    aliases: ['get', 'dl'],
    category: 'tools',
    description: 'Fetch content from a URL and send it to the chat',
    usage: '.fetch <url>',

    async execute(sock, msg, args, extra) {
        try {
            // Initial reaction
            await sock.sendMessage(extra.from, {
                react: { text: "🔍", key: msg.key }
            });

            // Extract URL from message
            const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
            const url = text.split(' ').slice(1).join(' ').trim();

            if (!url) {
                return await sock.sendMessage(extra.from, {
                    text: "❌ Please provide a valid URL to fetch."
                }, { quoted: msg });
            }

            // Validate URL format
            try {
                new URL(url);
            } catch (urlError) {
                return await sock.sendMessage(extra.from, {
                    text: "❌ Invalid URL format. Please provide a valid URL."
                }, { quoted: msg });
            }

            // Fetch content from URL
            const response = await axios.get(url, {
                responseType: 'arraybuffer',
                timeout: 70000,
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            const contentType = response.headers['content-type'];
            const buffer = Buffer.from(response.data);
            const filename = url.split('/').pop() || "file";

            // Check file size limit
            const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
            if (buffer.length > MAX_FILE_SIZE) {
                return await sock.sendMessage(extra.from, {
                    text: `❌ File is too large (${(buffer.length / (1024 * 1024)).toFixed(2)}MB). Maximum allowed size is ${MAX_FILE_SIZE / (1024 * 1024)}MB.`
                }, { quoted: msg });
            }

            // Handle different content types
            if (contentType.includes('application/json')) {
                try {
                    const json = JSON.parse(buffer.toString());
                    const jsonString = JSON.stringify(json, null, 2);
                    return await sock.sendMessage(extra.from, {
                        text: "```json\n" + jsonString + "\n```"
                    }, { quoted: msg });
                } catch (parseError) {
                    return await sock.sendMessage(extra.from, {
                        text: "❌ Failed to parse JSON. Sending as text.\n" + buffer.toString()
                    }, { quoted: msg });
                }
            }

            if (contentType.includes('text/html')) {
                const html = buffer.toString();
                return await sock.sendMessage(extra.from, {
                    text: html
                }, { quoted: msg });
            }

            if (contentType.includes('text/')) {
                return await sock.sendMessage(extra.from, {
                    text: buffer.toString()
                }, { quoted: msg });
            }

            if (contentType.includes('image')) {
                if (buffer.length > 16 * 1024 * 1024) { // 16MB limit for images
                    return await sock.sendMessage(extra.from, {
                        document: buffer,
                        fileName: filename,
                        mimetype: contentType
                    }, { quoted: msg });
                }
                return await sock.sendMessage(extra.from, {
                    image: buffer,
                    caption: `📷 ${url}`
                }, { quoted: msg });
            }

            if (contentType.includes('video')) {
                if (buffer.length > 16 * 1024 * 1024) { // 16MB limit for videos
                    return await sock.sendMessage(extra.from, {
                        document: buffer,
                        fileName: filename,
                        mimetype: contentType,
                        caption: `📹 Video too large for inline display. Sent as document.`
                    }, { quoted: msg });
                }
                return await sock.sendMessage(extra.from, {
                    video: buffer,
                    caption: `📹 ${url}`
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

            // Default fallback
            return await sock.sendMessage(extra.from, {
                document: buffer,
                fileName: filename,
                mimetype: contentType || 'application/octet-stream'
            }, { quoted: msg });

        } catch (error) {
            console.error('Error in fetchCommand:', error);

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
