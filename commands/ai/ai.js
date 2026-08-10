/**
 * AI Commands — powered by ravenn.site (Keith APIs)
 * All commands in a single array export.
 */

const axios = require('axios');
const FormData = require('form-data');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');

// ── Shared send helpers ───────────────────────────────────────────────────────

const react = (sock, msg, emoji) =>
    sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } });

const send = (sock, msg, text) =>
    sock.sendMessage(msg.key.remoteJid, { text }, { quoted: msg });

/**
 * Turn any API result shape (string, object, array, nested) into clean
 * human-readable text — never dumps raw JSON at the user.
 */
function cleanResult(result) {
    if (result == null) return '';
    if (typeof result === 'string') return result.trim();
    if (typeof result === 'number' || typeof result === 'boolean') return String(result);

    if (Array.isArray(result)) {
        return result.map(r => cleanResult(r)).filter(Boolean).join('\n\n');
    }

    if (typeof result === 'object') {
        const candidate =
            result.text ?? result.message ?? result.response ?? result.answer ??
            result.result ?? result.output ?? result.content ?? result.reply ?? null;
        if (candidate != null) return cleanResult(candidate);
        // No known text field — fall back to a compact, readable key:value list
        // instead of a raw JSON blob.
        return Object.entries(result)
            .filter(([, v]) => v != null && typeof v !== 'object')
            .map(([k, v]) => `${k}: ${v}`)
            .join('\n') || JSON.stringify(result);
    }

    return String(result);
}

// ── ravenn.site API helpers ───────────────────────────────────────────────────

/**
 * Call a ravenn.site JSON endpoint (full URL). Returns `data.result`.
 * Throws if status is false or result is a nested error object.
 */
async function ravenn(url, params = {}) {
    const { data } = await axios.get(url, { params, timeout: 60000 });
    if (!data.status) throw new Error(data.error || 'Service temporarily unavailable');
    // Some endpoints wrap a nested error inside result
    if (data.result && typeof data.result === 'object' && data.result.status === false) {
        throw new Error(data.result.error || 'API error from upstream');
    }
    return data.result;
}

/**
 * Call a ravenn.site endpoint that returns raw binary (e.g. JPEG). Takes a full URL.
 * Returns a Buffer. Detects accidental JSON error envelopes and throws them.
 */
async function ravennBinary(url, params = {}) {
    const resp = await axios.get(url, {
        params,
        responseType: 'arraybuffer',
        timeout: 60000,
    });
    const raw = Buffer.from(resp.data);
    // If the response is short enough to be JSON, try parsing it as an error envelope
    if (raw.length < 2048) {
        try {
            const json = JSON.parse(raw.toString('utf8'));
            if (json && json.status === false) {
                throw new Error(json.error || 'API returned an error instead of an image');
            }
        } catch (e) {
            if (e.message !== 'Unexpected token' && !e.message.startsWith('Unexpected end')) throw e;
            // Not JSON → truly binary; fall through
        }
    }
    return raw;
}

/**
 * Upload a file buffer to uguu.se and return its public URL.
 * Uguu accepts multipart uploads under the `files[]` field and returns a
 * JSON response — normally { success, files: [{ url, ... }] }, but some
 * deployments respond with a bare array, so both shapes are handled.
 */
async function uploadToUguu(buffer, filename = 'image.jpg', contentType = 'image/jpeg') {
    const form = new FormData();
    form.append('files[]', buffer, { filename, contentType });
    const { data } = await axios.post('https://uguu.se/upload', form, {
        headers: form.getHeaders(),
        timeout: 30000,
    });
    const fileEntry = Array.isArray(data) ? data[0]
        : Array.isArray(data?.files) ? data.files[0]
        : null;
    const url = fileEntry?.url;
    if (!url) throw new Error('Failed to upload file to Uguu');
    return url;
}

/**
 * Resolve an image URL from:
 *   1. args[0] if it starts with http
 *   2. Quoted image message (downloads + uploads to Uguu)
 * Returns { url, remainingArgs } where remainingArgs strips the URL arg if used.
 */
async function resolveImageUrl(sock, msg, args) {
    if (args[0] && /^https?:\/\//i.test(args[0])) {
        return { url: args[0], remainingArgs: args.slice(1) };
    }
    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    const quotedMsg = ctx?.quotedMessage;
    const imageMsg = quotedMsg?.imageMessage || quotedMsg?.stickerMessage;
    if (!imageMsg) return { url: null, remainingArgs: args };
    const target = {
        key: { remoteJid: msg.key.remoteJid, id: ctx.stanzaId, participant: ctx.participant },
        message: quotedMsg,
    };
    const buffer = await downloadMediaMessage(target, 'buffer', {}, {
        logger: undefined,
        reuploadRequest: sock.updateMediaMessage,
    });
    if (!buffer || !buffer.length) throw new Error('Could not download image from the replied message');
    const url = await uploadToUguu(buffer);
    return { url, remainingArgs: args };
}

/**
 * Resolve an audio URL from:
 *   1. args[0] if it starts with http
 *   2. Quoted audio/voice-note message (downloads + uploads to Uguu)
 * Returns { url, remainingArgs } where remainingArgs strips the URL arg if used.
 */
async function resolveAudioUrl(sock, msg, args) {
    if (args[0] && /^https?:\/\//i.test(args[0])) {
        return { url: args[0], remainingArgs: args.slice(1) };
    }
    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    const quotedMsg = ctx?.quotedMessage;
    const audioMsg = quotedMsg?.audioMessage;
    if (!audioMsg) return { url: null, remainingArgs: args };
    const target = {
        key: { remoteJid: msg.key.remoteJid, id: ctx.stanzaId, participant: ctx.participant },
        message: quotedMsg,
    };
    const buffer = await downloadMediaMessage(target, 'buffer', {}, {
        logger: undefined,
        reuploadRequest: sock.updateMediaMessage,
    });
    if (!buffer || !buffer.length) throw new Error('Could not download audio from the replied message');
    const mimetype = audioMsg.mimetype || 'audio/ogg';
    const ext = mimetype.includes('mpeg') ? 'mp3' : mimetype.includes('mp4') ? 'm4a' : 'ogg';
    const url = await uploadToUguu(buffer, `audio.${ext}`, mimetype);
    return { url, remainingArgs: args };
}

// ── Commands ──────────────────────────────────────────────────────────────────

module.exports = [

    // ═══════════════════════════════════════════════════════════════════════════
    // CHAT AI — text in, text out
    // ═══════════════════════════════════════════════════════════════════════════

    {
        name: 'ai',
        aliases: ['keithai', 'supremeai'],
        category: 'ai',
        description: 'Ask Keith AI (custom model) a question',
        usage: '.ai <question>',
        apiUrl: 'https://apiskeith2-production-3020.up.railway.app/keithai',
        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .ai How does the internet work?');
            await react(sock, msg, '⚡');
            try {
                const result = await ravenn(this.apiUrl, { q: query });
                await send(sock, msg, `⚡ *Keith AI*\n\n${cleanResult(result)}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[keithai]', err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ Keith AI error: ${err.message}`);
            }
        },
    },

    {
        name: 'chatgpt',
        aliases: ['gpt', 'gpt2', 'gptai'],
        category: 'ai',
        description: 'Ask GPT AI a question',
        usage: '.chatgpt <question>',
        apiUrl: 'https://apiskeith2-production-3020.up.railway.app/ai/gpt',
        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .chatgpt What is JavaScript?');
            await react(sock, msg, '🤖');
            try {
                const result = await ravenn(this.apiUrl, { q: query });
                await send(sock, msg, `🤖 *ChatGPT*\n\n${cleanResult(result)}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[chatgpt]', err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ ChatGPT error: ${err.message}`);
            }
        },
    },

    {
        name: 'gpt4o',
        aliases: ['gpt4', 'chatgpt4', 'gpt4nano', 'gpt41nano'],
        category: 'ai',
        description: 'Ask GPT-4 a question',
        usage: '.gpt4o <question>',
        apiUrl: 'https://apiskeith2-production-3020.up.railway.app/ai/chatgpt4',
        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .gpt4o How does a black hole form?');
            await react(sock, msg, '🤖');
            try {
                const result = await ravenn(this.apiUrl, { q: query });
                await send(sock, msg, `🤖 *GPT-4*\n\n${cleanResult(result)}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[gpt4o]', err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ GPT-4 error: ${err.message}`);
            }
        },
    },

    {
        name: 'claude',
        aliases: ['claudeai'],
        category: 'ai',
        description: 'Ask Claude AI a question',
        usage: '.claude <question>',
        apiUrl: 'https://apiskeith2-production-3020.up.railway.app/ai/claudeai',
        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .claude Explain recursion');
            await react(sock, msg, '🧠');
            try {
                const result = await ravenn(this.apiUrl, { q: query });
                await send(sock, msg, `🧠 *Claude AI*\n\n${cleanResult(result)}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[claude]', err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ Claude AI error: ${err.message}`);
            }
        },
    },

    {
        name: 'gemini',
        aliases: ['geminai'],
        category: 'ai',
        description: 'Ask Google Gemini a question',
        usage: '.gemini <question>',
        apiUrl: 'https://apiskeith2-production-3020.up.railway.app/ai/gemini',
        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .gemini Explain quantum physics');
            await react(sock, msg, '♊');
            try {
                const result = await ravenn(this.apiUrl, { q: query });
                await send(sock, msg, `♊ *Google Gemini*\n\n${cleanResult(result)}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[gemini]', err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ Gemini error: ${err.message}`);
            }
        },
    },

    {
        name: 'mistral',
        aliases: ['mistralai'],
        category: 'ai',
        description: 'Ask Mistral AI a question',
        usage: '.mistral <question>',
        apiUrl: 'https://apiskeith2-production-3020.up.railway.app/ai/mistral',
        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .mistral What is machine learning?');
            await react(sock, msg, '🔍');
            try {
                const result = await ravenn(this.apiUrl, { q: query });
                await send(sock, msg, `🔍 *Mistral AI*\n\n${cleanResult(result)}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[mistral]', err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ Mistral AI error: ${err.message}`);
            }
        },
    },

    {
        name: 'copilot',
        aliases: ['microsoftai'],
        category: 'ai',
        description: 'Ask Microsoft Copilot a question',
        usage: '.copilot <question>',
        apiUrl: 'https://apiskeith2-production-3020.up.railway.app/ai/copilot',
        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .copilot How are you?');
            await react(sock, msg, '🪟');
            try {
                const result = await ravenn(this.apiUrl, { q: query });
                await send(sock, msg, `🪟 *Microsoft Copilot*\n\n${cleanResult(result)}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[copilot]', err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ Copilot error: ${err.message}`);
            }
        },
    },

    {
        name: 'metaai',
        aliases: ['meta', 'metalai'],
        category: 'ai',
        description: 'Ask Meta AI a question',
        usage: '.metaai <question>',
        apiUrl: 'https://apiskeith2-production-3020.up.railway.app/ai/metai',
        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .metaai Hello, how are you?');
            await react(sock, msg, '💭');
            try {
                const result = await ravenn(this.apiUrl, { q: query });
                await send(sock, msg, `💭 *Meta AI*\n\n${cleanResult(result)}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[metaai]', err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ Meta AI error: ${err.message}`);
            }
        },
    },

    {
        name: 'aiLlama',
        aliases: ['llamaai', 'ilama', 'llama3'],
        category: 'ai',
        description: 'Ask Llama AI a question',
        usage: '.llama <question>',
        apiUrl: 'https://apiskeith2-production-3020.up.railway.app/ai/ilama',
        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .llama What is deep learning?');
            await react(sock, msg, '🦙');
            try {
                const result = await ravenn(this.apiUrl, { q: query });
                await send(sock, msg, `🦙 *Llama AI*\n\n${cleanResult(result)}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[llama]', err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ Llama AI error: ${err.message}`);
            }
        },
    },

    {
        name: 'blackbox',
        aliases: ['bb', 'blackboxai'],
        category: 'ai',
        description: 'Ask Blackbox AI a question',
        usage: '.blackbox <question>',
        apiUrl: 'https://apiskeith2-production-3020.up.railway.app/ai/blackbox',
        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .blackbox Explain recursion');
            await react(sock, msg, '📦');
            try {
                const result = await ravenn(this.apiUrl, { q: query });
                await send(sock, msg, `📦 *Blackbox AI*\n\n${cleanResult(result)}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[blackbox]', err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ Blackbox AI error: ${err.message}`);
            }
        },
    },

    {
        name: 'bard',
        aliases: ['googlebard'],
        category: 'ai',
        description: 'Ask Google Bard a question',
        usage: '.bard <question>',
        apiUrl: 'https://apiskeith2-production-3020.up.railway.app/ai/bard',
        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .bard Explain black holes');
            await react(sock, msg, '✨');
            try {
                const result = await ravenn(this.apiUrl, { q: query });
                await send(sock, msg, `✨ *Google Bard*\n\n${cleanResult(result)}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[bard]', err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ Bard error: ${err.message}`);
            }
        },
    },

    {
        name: 'perplexity',
        aliases: ['perplexai'],
        category: 'ai',
        description: 'Ask Perplexity AI a question',
        usage: '.perplexity <question>',
        apiUrl: 'https://apiskeith2-production-3020.up.railway.app/ai/perplexity',
        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .perplexity What is quantum computing?');
            await react(sock, msg, '🔎');
            try {
                const result = await ravenn(this.apiUrl, { q: query });
                await send(sock, msg, `🔎 *Perplexity AI*\n\n${cleanResult(result)}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[perplexity]', err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ Perplexity AI error: ${err.message}`);
            }
        },
    },

    {
        name: 'venice',
        aliases: ['vai', 'veniceai'],
        category: 'ai',
        description: 'Ask Venice AI a question',
        usage: '.venice <question>',
        apiUrl: 'https://apiskeith2-production-3020.up.railway.app/ai/venice',
        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .venice What is life?');
            await react(sock, msg, '🌊');
            try {
                const result = await ravenn(this.apiUrl, { q: query });
                await send(sock, msg, `🌊 *Venice AI*\n\n${cleanResult(result)}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[venice]', err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ Venice AI error: ${err.message}`);
            }
        },
    },

    {
        name: 'o3',
        aliases: ['o3ai', 'openai03'],
        category: 'ai',
        description: 'Ask O3 AI a question',
        usage: '.o3 <question>',
        apiUrl: 'https://apiskeith2-production-3020.up.railway.app/ai/o3',
        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .o3 What is consciousness?');
            await react(sock, msg, '🔵');
            try {
                const result = await ravenn(this.apiUrl, { q: query });
                await send(sock, msg, `🔵 *O3 AI*\n\n${cleanResult(result)}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[o3]', err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ O3 AI error: ${err.message}`);
            }
        },
    },

];
