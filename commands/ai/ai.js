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
 * Upload an image buffer to catbox.moe and return its public URL.
 */
async function uploadToCatbox(buffer) {
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('userhash', '');
    form.append('fileToUpload', buffer, { filename: 'image.jpg', contentType: 'image/jpeg' });
    const { data } = await axios.post('https://catbox.moe/user.php', form, {
        headers: form.getHeaders(),
        timeout: 30000,
    });
    if (!data || !data.startsWith('https://')) throw new Error('Failed to upload image to catbox');
    return data.trim();
}

/**
 * Resolve an image URL from:
 *   1. args[0] if it starts with http
 *   2. Quoted image message (downloads + uploads to catbox)
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
    const url = await uploadToCatbox(buffer);
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
        apiUrl: 'https://apiskeith2-production-ec66.up.railway.app/keithai',
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
        apiUrl: 'https://apiskeith2-production-ec66.up.railway.app/ai/gpt',
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
        apiUrl: 'https://apiskeith2-production-ec66.up.railway.app/ai/chatgpt4',
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
        apiUrl: 'https://apiskeith2-production-ec66.up.railway.app/ai/claudeai',
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
        apiUrl: 'https://apiskeith2-production-ec66.up.railway.app/ai/gemini',
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
        apiUrl: 'https://apiskeith2-production-ec66.up.railway.app/ai/mistral',
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
        apiUrl: 'https://apiskeith2-production-ec66.up.railway.app/ai/copilot',
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
        apiUrl: 'https://apiskeith2-production-ec66.up.railway.app/ai/metai',
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
        apiUrl: 'https://apiskeith2-production-ec66.up.railway.app/ai/ilama',
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
        apiUrl: 'https://apiskeith2-production-ec66.up.railway.app/ai/blackbox',
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
        apiUrl: 'https://apiskeith2-production-ec66.up.railway.app/ai/bard',
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
        apiUrl: 'https://apiskeith2-production-ec66.up.railway.app/ai/perplexity',
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
        apiUrl: 'https://apiskeith2-production-ec66.up.railway.app/ai/venice',
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
        apiUrl: 'https://apiskeith2-production-ec66.up.railway.app/ai/o3',
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

    {
        name: 'grok',
        aliases: ['grokai', 'xai'],
        category: 'ai',
        description: 'Ask Grok AI a question',
        usage: '.grok <question>',
        apiUrl: 'https://apiskeith2-production-ec66.up.railway.app/ai/grok',
        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .grok Explain dark matter');
            await react(sock, msg, '🚀');
            try {
                const result = await ravenn(this.apiUrl, { q: query });
                await send(sock, msg, `🚀 *Grok AI*\n\n${cleanResult(result)}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[grok]', err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ Grok AI error: ${err.message}`);
            }
        },
    },

    {
        name: 'deepseek',
        aliases: ['deepseekr1', 'think'],
        category: 'ai',
        description: 'Ask Deepseek R1 (reasoning model) a question',
        usage: '.deepseek <question>',
        apiUrl: 'https://apiskeith2-production-ec66.up.railway.app/ai/deepseek',
        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .deepseek Analyze the trolley problem');
            await react(sock, msg, '🧠');
            try {
                const result = await ravenn(this.apiUrl, { q: query });
                // Strip <think>...</think> reasoning chain for cleaner output
                const clean = cleanResult(result).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
                await send(sock, msg, `🧠 *Deepseek R1*\n\n${clean}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[deepseek]', err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ Deepseek R1 error: ${err.message}`);
            }
        },
    },

    {
        name: 'deepseekv3',
        aliases: ['dsv3'],
        category: 'ai',
        description: 'Ask Deepseek V3 a question',
        usage: '.deepseekv3 <question>',
        apiUrl: 'https://apiskeith2-production-ec66.up.railway.app/ai/deepseekV3',
        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .deepseekv3 Write a poem about rain');
            await react(sock, msg, '💙');
            try {
                const result = await ravenn(this.apiUrl, { q: query });
                await send(sock, msg, `💙 *Deepseek V3*\n\n${cleanResult(result)}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[deepseekv3]', err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ Deepseek V3 error: ${err.message}`);
            }
        },
    },

    {
        name: 'qwen',
        aliases: ['qwenai', 'qwena'],
        category: 'ai',
        description: 'Ask Qwen AI a question',
        usage: '.qwen <question>',
        apiUrl: 'https://apiskeith2-production-ec66.up.railway.app/ai/qwenai',
        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .qwen What is Alibaba?');
            await react(sock, msg, '🟣');
            try {
                const result = await ravenn(this.apiUrl, { q: query });
                await send(sock, msg, `🟣 *Qwen AI*\n\n${cleanResult(result)}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[qwen]', err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ Qwen AI error: ${err.message}`);
            }
        },
    },

    {
        name: 'wormgpt',
        aliases: ['wgpt', 'darkgpt'],
        category: 'ai',
        description: 'Ask WormGPT a question',
        usage: '.wormgpt <question>',
        apiUrl: 'https://apiskeith2-production-ec66.up.railway.app/ai/wormgpt',
        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .wormgpt hi');
            await react(sock, msg, '😈');
            try {
                const result = await ravenn(this.apiUrl, { q: query });
                await send(sock, msg, `😈 *WormGPT*\n\n${cleanResult(result)}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[wormgpt]', err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ WormGPT error: ${err.message}`);
            }
        },
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // SEARCH / WEB AI
    // ═══════════════════════════════════════════════════════════════════════════

    {
        name: 'searchai',
        aliases: ['compound', 'websearch', 'ainews', 'news'],
        category: 'ai',
        description: 'AI-powered web search — get detailed answers from the web',
        usage: '.searchai <query>',
        apiUrl: 'https://apiskeith2-production-ec66.up.railway.app/ai/searchai',
        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a search query\n\nExample: .searchai latest AI news');
            await react(sock, msg, '🌐');
            try {
                const result = await ravenn(this.apiUrl, { query });
                // result can be a string or array of search objects
                let text;
                if (typeof result === 'string') {
                    text = result;
                } else if (Array.isArray(result)) {
                    text = result.slice(0, 3).map((r, i) => {
                        const ans = r?.question?.answer;
                        const body = ans?.body || ans?.text || cleanResult(r);
                        return `*${i + 1}.* ${body}`;
                    }).join('\n\n');
                } else {
                    text = cleanResult(result);
                }
                await send(sock, msg, `🌐 *AI Web Search*\n\n${text}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[searchai]', err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ Search AI error: ${err.message}`);
            }
        },
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // SUMMARIZE / RESEARCH  (prompt-wrapped keith AI)
    // ═══════════════════════════════════════════════════════════════════════════

    {
        name: 'summarize',
        aliases: ['summary'],
        category: 'ai',
        description: 'Summarize text using AI',
        usage: '.summarize <text>',
        apiUrl: 'https://apiskeith2-production-ec66.up.railway.app/keithai',
        async execute(sock, msg, args, extra) {
            const text = args.join(' ').trim();
            if (!text) return extra.reply('❌ Please provide text to summarize\n\nExample: .summarize Paste your long text here');
            await react(sock, msg, '📝');
            try {
                const result = await ravenn(this.apiUrl, { q: `Summarize the following text concisely:\n\n${text}` });
                await send(sock, msg, `📝 *Summary*\n\n${cleanResult(result)}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[summarize]', err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ Summarize error: ${err.message}`);
            }
        },
    },

    {
        name: 'scite',
        aliases: ['research', 'science'],
        category: 'ai',
        description: 'AI-powered academic/research question answering',
        usage: '.scite <research question>',
        apiUrl: 'https://apiskeith2-production-ec66.up.railway.app/keithai',
        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a research question\n\nExample: .scite Effects of caffeine on sleep');
            await react(sock, msg, '🔬');
            try {
                const result = await ravenn(this.apiUrl, { q: `Answer this academic/research question in detail: ${query}` });
                await send(sock, msg, `🔬 *Research AI*\n\n${cleanResult(result)}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[scite]', err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ Research AI error: ${err.message}`);
            }
        },
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // CODE AI
    // ═══════════════════════════════════════════════════════════════════════════

    {
        name: 'codegen',
        aliases: ['code', 'generatecode'],
        category: 'ai',
        description: 'Generate code in any language using AI',
        usage: '.codegen <description>',
        apiUrl: 'https://apiskeith2-production-ec66.up.railway.app/ai/codegen',
        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please describe the code to generate\n\nExample: .codegen REST API in Node.js');
            await react(sock, msg, '💻');
            try {
                const result = await ravenn(this.apiUrl, { q: query });
                await send(sock, msg, `💻 *Code Generator*\n\n${cleanResult(result)}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[codegen]', err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ Code Generator error: ${err.message}`);
            }
        },
    },

    {
        name: 'codedescribe',
        aliases: ['whatscode', 'explaincode'],
        category: 'ai',
        description: 'Explain what a piece of code does',
        usage: '.codedescribe <code>',
        apiUrl: 'https://apiskeith2-production-ec66.up.railway.app/whatdoesthiscodedo',
        async execute(sock, msg, args, extra) {
            const code = args.join(' ').trim();
            if (!code) return extra.reply('❌ Please provide code to explain\n\nExample: .codedescribe console.log(\'hello\')');
            await react(sock, msg, '🔍');
            try {
                const result = await ravenn(this.apiUrl, { code });
                await send(sock, msg, `🔍 *Code Explained*\n\n${cleanResult(result)}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[codedescribe]', err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ Code Describe error: ${err.message}`);
            }
        },
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // CREATIVE AI
    // ═══════════════════════════════════════════════════════════════════════════

    {
        name: 'lyricsgen',
        aliases: ['genlyrics', 'ailyrics'],
        category: 'ai',
        description: 'Generate song lyrics. Format: .lyricsgen topic | genre | mood | structure | language',
        usage: '.lyricsgen heartbreak | blues | sad | verse_chorus_bridge | en',
        apiUrl: 'https://apiskeith2-production-ec66.up.railway.app/ai/lyricsgen',
        async execute(sock, msg, args, extra) {
            const input = args.join(' ').trim();
            if (!input) {
                return extra.reply(
                    `🎵 *Lyrics Generator*\n\n` +
                    `Format: _.lyricsgen topic | genre | mood | structure | language_\n\n` +
                    `Example: _.lyricsgen heartbreak | blues | sad | verse_chorus_bridge | en_\n\n` +
                    `*Defaults:* genre=pop, mood=happy, structure=verse_chorus, language=en`
                );
            }
            const parts = input.split('|').map(s => s.trim());
            const [topic = input, genre = 'pop', mood = 'happy', structure = 'verse_chorus', language = 'en'] = parts;
            await react(sock, msg, '🎵');
            try {
                const result = await ravenn(this.apiUrl, { topic, genre, mood, structure, language });
                await send(sock, msg, `🎵 *Generated Lyrics*\n\n${cleanResult(result)}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[lyricsgen]', err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ Lyrics Generator error: ${err.message}`);
            }
        },
    },

    {
        name: 'speechwriter',
        aliases: ['writespeech', 'speech'],
        category: 'ai',
        description: 'Write a speech on any topic. Format: .speechwriter topic | length | type | tone',
        usage: '.speechwriter how to pass exams | short | dedication | serious',
        apiUrl: 'https://apiskeith2-production-ec66.up.railway.app/ai/speechwriter',
        async execute(sock, msg, args, extra) {
            const input = args.join(' ').trim();
            if (!input) {
                return extra.reply(
                    `🎤 *Speech Writer*\n\n` +
                    `Format: _.speechwriter topic | length | type | tone_\n\n` +
                    `Example: _.speechwriter climate change | medium | persuasive | serious_\n\n` +
                    `*Lengths:* short, medium, long\n` +
                    `*Types:* dedication, persuasive, informative, motivational\n` +
                    `*Tones:* serious, casual, formal, inspirational`
                );
            }
            const parts = input.split('|').map(s => s.trim());
            const [topic = input, length = 'short', type = 'informative', tone = 'formal'] = parts;
            await react(sock, msg, '🎤');
            try {
                const result = await ravenn(this.apiUrl, { topic, length, type, tone });
                await send(sock, msg, `🎤 *Speech*\n\n${cleanResult(result)}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[speechwriter]', err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ Speech Writer error: ${err.message}`);
            }
        },
    },

    {
        name: 'dreamanalyzer',
        aliases: ['dream', 'analyzedream'],
        category: 'ai',
        description: 'Interpret and analyze your dreams using AI',
        usage: '.dreamanalyzer <describe your dream>',
        apiUrl: 'https://apiskeith2-production-ec66.up.railway.app/ai/dreamanalyzer',
        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please describe your dream\n\nExample: .dreamanalyzer I dreamt about flying over the ocean');
            await react(sock, msg, '🌙');
            try {
                const result = await ravenn(this.apiUrl, { q: query });
                await send(sock, msg, `🌙 *Dream Analysis*\n\n${cleanResult(result)}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[dreamanalyzer]', err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ Dream Analyzer error: ${err.message}`);
            }
        },
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // VISION AI
    // ═══════════════════════════════════════════════════════════════════════════

    {
        name: 'vision',
        aliases: ['see', 'aiview', 'describe'],
        category: 'ai',
        description: 'Analyze an image using AI vision. Reply to an image or provide a URL.',
        usage: '.vision <question> (reply to image) | .vision <url> <question>',
        apiUrl: 'https://apiskeith2-production-ec66.up.railway.app/ai/vision',
        async execute(sock, msg, args, extra) {
            await react(sock, msg, '👁️');
            try {
                const { url: imageUrl, remainingArgs } = await resolveImageUrl(sock, msg, args);
                if (!imageUrl) {
                    return extra.reply(
                        `👁️ *AI Vision*\n\n` +
                        `Reply to an image and ask a question:\n` +
                        `_Reply to image + .vision What is in this image?_\n\n` +
                        `Or provide a URL:\n` +
                        `_.vision https://example.com/img.jpg What is this?_`
                    );
                }
                const q = remainingArgs.join(' ').trim() || "What's in this image?";
                const result = await ravenn(this.apiUrl, { image: imageUrl, q });
                await send(sock, msg, `👁️ *AI Vision*\n\n${cleanResult(result)}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[vision]', err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ Vision AI error: ${err.message}`);
            }
        },
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // SPEECH / AUDIO AI
    // ═══════════════════════════════════════════════════════════════════════════

    {
        name: 'aitts',
        aliases: ['texttospeech', 'aispeech'],
        category: 'ai',
        description: 'Convert text to speech using AI voices',
        usage: '.tts <text>',
        apiUrl: 'https://apiskeith2-production-ec66.up.railway.app/ai/tts',
        async execute(sock, msg, args, extra) {
            const text = args.join(' ').trim();
            if (!text) return extra.reply('❌ Please provide text\n\nExample: .tts Hello, how are you today?');
            await react(sock, msg, '🔊');
            try {
                const result = await ravenn(this.apiUrl, { q: text });
                const voices = Array.isArray(result) ? result : [];
                if (!voices.length) throw new Error('No voices returned');
                // Send first voice's audio
                const voice = voices[0];
                await sock.sendMessage(extra.from, {
                    audio: { url: voice.audio_url },
                    mimetype: 'audio/mpeg',
                    ptt: false,
                }, { quoted: msg });
                // List all available voice names
                const names = voices.slice(0, 8).map(v => `• ${v.voice_name}`).join('\n');
                await send(sock, msg, `🔊 *Text to Speech*\n\n_Voice: ${voice.voice_name}_\n\n*Other available voices:*\n${names}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[tts]', err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ TTS error: ${err.message}`);
            }
        },
    },

    {
        name: 'whisper',
        aliases: ['speech2text', 'aistranscribe'],
        category: 'ai',
        description: 'Transcribe audio from a URL using AI',
        usage: '.whisper <audio url>',
        apiUrl: 'https://apiskeith2-production-ec66.up.railway.app/ai/transcribe',
        async execute(sock, msg, args, extra) {
            const url = args[0]?.trim();
            if (!url || !url.startsWith('http')) {
                return extra.reply('❌ Please provide an audio URL\n\nExample: .whisper https://example.com/audio.mp3');
            }
            await react(sock, msg, '🎙️');
            try {
                const result = await ravenn(this.apiUrl, { q: url });
                const text = typeof result === 'string' ? result
                    : (result?.text || result?.transcript || cleanResult(result));
                await send(sock, msg, `🎙️ *Transcription*\n\n${text}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[whisper]', err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ Transcribe error: ${err.message}`);
            }
        },
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // IMAGE GENERATION
    // ═══════════════════════════════════════════════════════════════════════════

    {
        name: 'magicstudio',
        aliases: ['magic', 'magicai'],
        category: 'ai',
        description: 'Generate an AI image using Magic Studio',
        usage: '.magicstudio <prompt>',
        apiUrl: 'https://apiskeith2-production-ec66.up.railway.app/ai/magicstudio',
        async execute(sock, msg, args, extra) {
            const prompt = args.join(' ').trim();
            if (!prompt) return extra.reply('❌ Please provide a prompt\n\nExample: .magicstudio a futuristic city at sunset');
            await react(sock, msg, '✨');
            try {
                const buffer = await ravennBinary(this.apiUrl, { prompt });
                await sock.sendMessage(extra.from, {
                    image: buffer,
                    caption: `✨ *Magic Studio AI*\n\n_Prompt:_ ${prompt}`,
                }, { quoted: msg });
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[magicstudio]', err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ Magic Studio error: ${err.message}`);
            }
        },
    },

    {
        name: 'generate',
        aliases: ['genimage', 'aiimage', 'dalle', 'flux', 'fluxai'],
        category: 'ai',
        description: 'Generate an AI image using Flux (ravenn.site)',
        usage: '.generate <prompt>',
        apiUrl: 'https://apiskeith2-production-ec66.up.railway.app/ai/flux',
        async execute(sock, msg, args, extra) {
            const prompt = args.join(' ').trim();
            if (!prompt) return extra.reply('❌ Please provide a prompt\n\nExample: .generate sunset over mountains');
            await react(sock, msg, '🎨');
            try {
                const resp = await axios.get(this.apiUrl, {
                    params: { q: prompt },
                    responseType: 'arraybuffer',
                    timeout: 60000,
                });
                const raw = Buffer.from(resp.data);

                // Always try parsing as JSON first to catch error envelopes or URL results
                let handled = false;
                try {
                    const json = JSON.parse(raw.toString('utf8'));
                    // Explicit error from API
                    if (json.status === false) {
                        throw new Error(json.error || 'Flux service returned an error');
                    }
                    // API returned a URL inside result
                    const imgUrl = typeof json.result === 'string' ? json.result : null;
                    if (imgUrl) {
                        await sock.sendMessage(extra.from, {
                            image: { url: imgUrl },
                            caption: `🎨 *AI Image*\n\n_Prompt:_ ${prompt}`,
                        }, { quoted: msg });
                        handled = true;
                    }
                } catch (jsonErr) {
                    // If it was our explicit API error, rethrow it
                    if (!(jsonErr instanceof SyntaxError)) throw jsonErr;
                    // Otherwise it was not JSON at all — treat as binary below
                }

                if (!handled) {
                    // Response is raw binary image bytes
                    if (raw.length < 100) throw new Error('Response too small to be a valid image');
                    await sock.sendMessage(extra.from, {
                        image: raw,
                        caption: `🎨 *AI Image*\n\n_Prompt:_ ${prompt}`,
                    }, { quoted: msg });
                }

                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[generate]', err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ Image generation failed: ${err.message}`);
            }
        },
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // IMAGE PROCESSING
    // ═══════════════════════════════════════════════════════════════════════════

    {
        name: 'removebg',
        aliases: ['rembg', 'removebackground', 'bgremove'],
        category: 'ai',
        description: 'Remove the background from an image. Reply to image or provide URL.',
        usage: '.removebg (reply to image) | .removebg <url>',
        apiUrl: 'https://apiskeith2-production-ec66.up.railway.app/ai/removebg',
        async execute(sock, msg, args, extra) {
            await react(sock, msg, '✂️');
            try {
                const { url } = await resolveImageUrl(sock, msg, args);
                if (!url) {
                    return extra.reply('❌ Reply to an image or provide an image URL\n\nExample: .removebg https://example.com/image.jpg');
                }
                const result = await ravenn(this.apiUrl, { url });
                const imgUrl = typeof result === 'string' ? result
                    : Array.isArray(result) ? result[0] : result?.url || cleanResult(result);
                await sock.sendMessage(extra.from, {
                    image: { url: imgUrl },
                    caption: '✂️ *Background Removed*',
                }, { quoted: msg });
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[removebg]', err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ Remove BG error: ${err.message}`);
            }
        },
    },

    {
        name: 'imagehd',
        aliases: ['enhanceimage', 'hd', 'aiupscale'],
        category: 'ai',
        description: 'Enhance an image to HD quality using AI. Reply to image or provide URL.',
        usage: '.imagehd (reply to image) | .imagehd <url>',
        apiUrl: 'https://apiskeith2-production-ec66.up.railway.app/ai/hd',
        async execute(sock, msg, args, extra) {
            await react(sock, msg, '🔆');
            try {
                const { url } = await resolveImageUrl(sock, msg, args);
                if (!url) {
                    return extra.reply('❌ Reply to an image or provide an image URL\n\nExample: .imagehd https://example.com/image.jpg');
                }
                const result = await ravenn(this.apiUrl, { url });
                // result is an array with one URL
                const imgUrl = Array.isArray(result) ? result[0]
                    : typeof result === 'string' ? result : null;
                if (!imgUrl) throw new Error('No enhanced image URL returned');
                await sock.sendMessage(extra.from, {
                    image: { url: imgUrl },
                    caption: '🔆 *Image Enhanced to HD*',
                }, { quoted: msg });
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[imagehd]', err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ Image HD error: ${err.message}`);
            }
        },
    },

    {
        name: 'imageedit',
        aliases: ['editimage', 'aiedit', 'editimg'],
        category: 'ai',
        description: 'Edit an image with an AI instruction. Reply to image or provide URL.',
        usage: '.imageedit <instruction> (reply to image) | .imageedit <url> <instruction>',
        apiUrl: 'https://apiskeith2-production-ec66.up.railway.app/ai/imageedit',
        async execute(sock, msg, args, extra) {
            await react(sock, msg, '🖌️');
            try {
                const { url, remainingArgs } = await resolveImageUrl(sock, msg, args);
                const instruction = remainingArgs.join(' ').trim();
                if (!url || !instruction) {
                    return extra.reply(
                        `🖌️ *AI Image Editor*\n\n` +
                        `Reply to an image and add an instruction:\n` +
                        `_Reply to image + .imageedit make it black and white_\n\n` +
                        `Or with a URL:\n` +
                        `_.imageedit https://example.com/img.jpg make him smile_`
                    );
                }
                const result = await ravenn(this.apiUrl, { q: instruction, url });
                const imgUrl = typeof result === 'string' ? result
                    : Array.isArray(result) ? result[0] : result?.url || null;
                if (!imgUrl) throw new Error('No edited image returned');
                await sock.sendMessage(extra.from, {
                    image: { url: imgUrl },
                    caption: `🖌️ *AI Edited Image*\n\n_Instruction:_ ${instruction}`,
                }, { quoted: msg });
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[imageedit]', err.message);
                await react(sock, msg, '❌');
                extra.reply(`❌ Image Edit error: ${err.message}`);
            }
        },
    },

];
