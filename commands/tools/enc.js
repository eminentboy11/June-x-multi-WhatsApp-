/**
 * Encrypt Command - Obfuscate JavaScript files using js-confuser
 * Reply to a .js file with .enc or .encrypt
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const JsConfuser = require('js-confuser');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

module.exports = {
    name: 'encrypt',
    aliases: ['enc', 'obf'],
    category: 'tools',
    description: 'Encrypt/obfuscate a JavaScript file with hard code protection',
    usage: '.enc (reply to a .js file)',

    async execute(sock, msg, args, extra) {
        const { from, reply, isOwner } = extra;

        try {
            // Initial reaction
            await sock.sendMessage(from, {
                react: { text: "🔐", key: msg.key }
            });

            // Derive sender (for logging)
            const sender = msg.key.participant || msg.key.remoteJid;

            // Use system temp directory
            const tempDir = path.join(os.tmpdir(), "june-x-temp");
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

            // Extract quoted message from any possible message type
            const quotedMsg =
                msg.message?.extendedTextMessage?.contextInfo?.quotedMessage ||
                msg.message?.imageMessage?.contextInfo?.quotedMessage ||
                msg.message?.videoMessage?.contextInfo?.quotedMessage ||
                msg.message?.audioMessage?.contextInfo?.quotedMessage ||
                msg.message?.stickerMessage?.contextInfo?.quotedMessage;

            if (!quotedMsg) {
                return reply(
                    "🔐 *Encrypt Command Usage*\n\n" +
                    "Reply to a JavaScript (.js) file with `.enc` or `.encrypt`\n\n" +
                    "📌 *Example:*\n" +
                    "1. Send a .js file\n" +
                    "2. Reply to it with `.enc`\n\n" +
                    "✨ *Features:*\n" +
                    "• Hard code obfuscation\n" +
                    "• Variable renaming\n" +
                    "• String encoding\n" +
                    "• Control flow flattening"
                );
            }

            const doc = quotedMsg.documentMessage;
            if (!doc || !doc.fileName || !doc.fileName.endsWith('.js')) {
                return reply("❌ *Invalid File*\nPlease reply to a JavaScript (.js) file to encrypt.");
            }

            // Download the file (stream -> buffer)
            const stream = await downloadContentFromMessage(doc, 'document');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }

            if (!buffer || buffer.length === 0) {
                throw new Error("Failed to download the file or file is empty!");
            }

            const fileSize = buffer.length;
            const fileSizeKB = (fileSize / 1024).toFixed(2);

            // Check file size (max 5MB to prevent abuse)
            if (fileSize > 5 * 1024 * 1024) {
                return reply("❌ *File Too Large*\nMaximum file size is 5MB for encryption.");
            }

            const fileName = doc.fileName;
            const originalCode = buffer.toString('utf8');

            // Update reaction to show progress
            await sock.sendMessage(from, {
                react: { text: "⚙️", key: msg.key }
            });

            const obfuscatedCode = await JsConfuser.obfuscate(originalCode, {
                target: "node",
                preset: "high",
                compact: true,
                minify: true,
                flatten: true,
                identifierGenerator: function() {
                    const originalString = "晴素晴素晴ˢᵁᴾᴿᴱᴹᴱ素晴晴" + "素晴晴ˢᵁᴾᴿᴱᴹᴱ素晴晴";
                    const removeUnwantedChars = (input) => input.replace(/[^a-zA-Z素GIDDY晴TENNOR晴]/g, "");
                    const randomString = (length) => {
                        let result = "";
                        const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
                        for (let i = 0; i < length; i++) {
                            result += characters.charAt(Math.floor(Math.random() * characters.length));
                        }
                        return result;
                    };
                    return removeUnwantedChars(originalString) + randomString(2);
                },
                renameVariables: true,
                renameGlobals: true,
                stringEncoding: true,
                stringSplitting: 0.0,
                stringConcealing: true,
                stringCompression: true,
                duplicateLiteralsRemoval: 1.0,
                shuffle: { hash: 0.0, true: 0.0 },
                stack: true,
                controlFlowFlattening: 1.0,
                opaquePredicates: 0.9,
                deadCode: 0.0,
                dispatcher: true,
                rgf: false,
                calculator: true,
                hexadecimalNumbers: true,
                movedDeclarations: true,
                objectExtraction: true,
                globalConcealing: true,
            });

            const obfuscatedSize = Buffer.byteLength(obfuscatedCode, 'utf8');
            const obfuscatedSizeKB = (obfuscatedSize / 1024).toFixed(2);
            const sizeIncrease = ((obfuscatedSize - fileSize) / fileSize * 100).toFixed(2);

            // Create temp file (optional backup)
            const timestamp = Date.now();
            const tempFilePath = path.join(tempDir, `encrypted_${timestamp}.js`);
            fs.writeFileSync(tempFilePath, obfuscatedCode);

            // Success reaction
            await sock.sendMessage(from, {
                react: { text: "✅", key: msg.key }
            });

            // Send obfuscated file back without caption
            await sock.sendMessage(from, {
                document: Buffer.from(obfuscatedCode, 'utf8'),
                mimetype: 'application/javascript',
                fileName: fileName
            }, { quoted: msg });

            // Cleanup temp file
            if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);

        } catch (error) {
            console.error("Encrypt command error:", error);

            // Send error reaction
            await sock.sendMessage(from, {
                react: { text: "❌", key: msg.key }
            });

            let errorMessage = `🚫 *Encryption Error:* ${error.message}`;

            if (error.message.includes('syntax')) {
                errorMessage = "❌ *Syntax Error!*\nThe JavaScript file contains syntax errors that prevent encryption.";
            } else if (error.message.includes('download')) {
                errorMessage = "❌ *Download Failed!*\nCould not download the file. Please try again.";
            } else if (error.message.includes('timeout')) {
                errorMessage = "⏱️ *Encryption Timeout!*\nThe file might be too complex. Try with a simpler script.";
            }

            return reply(errorMessage);
        }
    }
};
