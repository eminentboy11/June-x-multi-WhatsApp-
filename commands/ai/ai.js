/**
 * AI Commands
 */

const axios = require('axios');

// ── Shared send helpers ───────────────────────────────────────────────────────

const react = (sock, msg, emoji) =>
    sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } });

const send = (sock, msg, text) =>
    sock.sendMessage(msg.key.remoteJid, { text }, { quoted: msg });

const imageUrl = (prompt) =>
    `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&enhance=true`;

// ── Commands ──────────────────────────────────────────────────────────────────

module.exports = [

    // ── IMAGE GENERATION ──────────────────────────────────────────────────────

    {
        name: 'generate',
        aliases: ['genimage', 'aiimage'],
        category: 'ai',
        description: 'Generate an AI image from a text prompt using Flux',
        usage: '.generate <prompt>',
        async execute(sock, msg, args, extra) {
            const prompt = args.join(' ').trim();
            if (!prompt) return extra.reply('❌ Please provide a prompt\n\nExample: .generate sunset over mountains');
            await react(sock, msg, '🎨');
            try {
                const url = imageUrl(prompt);
                await sock.sendMessage(extra.from, { image: { url }, caption: `🎨 *AI Image*\n\n_Prompt:_ ${prompt}` }, { quoted: msg });
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[generate]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Failed to generate image. Please try again.');
            }
        },
    },

    {
        name: 'dalle',
        aliases: ['luminai', 'flux', 'fluxai'],
        category: 'ai',
        description: 'Generate an AI image using Flux via Pollinations',
        usage: '.dalle <prompt>',
        async execute(sock, msg, args, extra) {
            const prompt = args.join(' ').trim();
            if (!prompt) return extra.reply('❌ Please provide a prompt\n\nExample: .dalle futuristic city at night');
            await react(sock, msg, '🌟');
            try {
                const url = imageUrl(prompt);
                await sock.sendMessage(extra.from, { image: { url }, caption: `🌟 *Flux AI Image*\n\n_Prompt:_ ${prompt}` }, { quoted: msg });
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[dalle]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Flux image generation failed. Please try again.');
            }
        },
    },

    // ── CHATGPT ───────────────────────────────────────────────────────────────

    {
        name: 'chatgpt',
        aliases: ['gpt'],
        category: 'ai',
        description: 'Ask ChatGPT a question',
        usage: '.chatgpt <question>',
        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .chatgpt What is JavaScript?');
            await react(sock, msg, '🤖');
            try {
                const { data } = await axios.get('https://apis.xcasper.space/api/ai/letmegpt', { params: { prompt: query }, timeout: 60000 });
                if (!data?.success || !data.reply) throw new Error('No reply');
                await send(sock, msg, `🤖 *ChatGPT*\n\n${data.reply}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[chatgpt]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ ChatGPT service error. Please try again later.');
            }
        },
    },

    // ── GPT2 ──────────────────────────────────────────────────────────────────

    {
        name: 'gpt2',
        aliases: ['gptai'],
        category: 'ai',
        description: 'Ask GPT a question',
        usage: '.gpt2 <question>',
        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .gpt2 What is artificial intelligence?');
            await react(sock, msg, '🤖');
            try {
                const { data } = await axios.get('https://apis.xcasper.space/api/ai/letmegpt', { params: { prompt: query }, timeout: 60000 });
                if (!data?.success || !data.reply) throw new Error('No reply');
                await send(sock, msg, `🤖 *GPT Response*\n\n${data.reply}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[gpt2]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ GPT service error. Please try again later.');
            }
        },
    },

    // ── COPILOT ───────────────────────────────────────────────────────────────

    {
        name: 'copilot',
        aliases: [],
        category: 'ai',
        description: 'Ask Microsoft Copilot a question',
        usage: '.copilot <question>',
        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .copilot How are you?');
            await react(sock, msg, '🪟');
            try {
                const { data } = await axios.get('https://apis.xcasper.space/api/ai/grok', { params: { query }, timeout: 60000 });
                if (!data?.success || !data.reply) throw new Error('No reply');
                await send(sock, msg, `🪟 *Microsoft Copilot*\n\n${data.reply}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[copilot]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Copilot service error. Please try again later.');
            }
        },
    },

    // ── META AI ───────────────────────────────────────────────────────────────

    {
        name: 'metaai',
        aliases: ['meta'],
        category: 'ai',
        description: 'Ask Meta AI a question',
        usage: '.metaai <question>',
        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .metaai Hello, how are you?');
            await react(sock, msg, '💭');
            try {
                const { data } = await axios.get('https://apis.xcasper.space/api/ai/huggingface', { params: { prompt: query }, timeout: 60000 });
                if (!data?.success || !data.reply) throw new Error('No reply');
                await send(sock, msg, `💭 *Meta AI*\n\n${data.reply}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[metaai]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Meta AI service error. Please try again later.');
            }
        },
    },

    // ── LLAMA ─────────────────────────────────────────────────────────────────

    {
        name: 'llama',
        aliases: ['llamaai'],
        category: 'ai',
        description: 'Ask Llama 3.3 70B a question',
        usage: '.llama <question>',
        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .llama What is deep learning?');
            await react(sock, msg, '🦙');
            try {
                const { data } = await axios.get('https://apis.xcasper.space/api/ai/huggingface', { params: { prompt: query }, timeout: 60000 });
                if (!data?.success || !data.reply) throw new Error('No reply');
                await send(sock, msg, `🦙 *Llama AI*\n\n${data.reply}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[llama]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Llama AI service error. Please try again later.');
            }
        },
    },

    // ── BLACKBOX ──────────────────────────────────────────────────────────────

    {
        name: 'blackbox',
        aliases: ['bb'],
        category: 'ai',
        description: 'Ask Blackbox AI a question',
        usage: '.blackbox <question>',
        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .blackbox Explain recursion');
            await react(sock, msg, '📦');
            try {
                const { data } = await axios.get('https://apis.xcasper.space/api/ai/cohere', { params: { prompt: query }, timeout: 60000 });
                if (!data?.success || !data.reply) throw new Error('No reply');
                await send(sock, msg, `📦 *Blackbox AI*\n\n${data.reply}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[blackbox]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Blackbox AI service error. Please try again later.');
            }
        },
    },

    // ── SUMMARIZE ─────────────────────────────────────────────────────────────

    {
        name: 'summarize',
        aliases: ['summary'],
        category: 'ai',
        description: 'Summarize text using AI',
        usage: '.summarize <text>',
        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide text to summarize\n\nExample: .summarize Paste your long text here');
            await react(sock, msg, '📝');
            try {
                const { data } = await axios.get('https://apis.xcasper.space/api/ai/cohere', { params: { prompt: `Summarize the following text concisely:\n\n${query}` }, timeout: 60000 });
                if (!data?.success || !data.reply) throw new Error('No reply');
                await send(sock, msg, `📝 *Summary*\n\n${data.reply}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[summarize]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Summarize service error. Please try again later.');
            }
        },
    },

    // ── MISTRAL ───────────────────────────────────────────────────────────────

    {
        name: 'mistral',
        aliases: ['mistralai'],
        category: 'ai',
        description: 'Ask Mistral AI a question',
        usage: '.mistral <question>',
        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .mistral What is machine learning?');
            await react(sock, msg, '🔍');
            try {
                const { data } = await axios.get('https://apis.xcasper.space/api/ai/cohere', { params: { prompt: query }, timeout: 60000 });
                if (!data?.success || !data.reply) throw new Error('No reply');
                await send(sock, msg, `🔍 *Mistral AI*\n\n${data.reply}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[mistral]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Mistral AI service error. Please try again later.');
            }
        },
    },

    // ── THINK ─────────────────────────────────────────────────────────────────

    {
        name: 'think',
        aliases: [],
        category: 'ai',
        description: 'Deep thinking mode powered by large model reasoning',
        usage: '.think <complex question>',
        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .think Analyze the ethics of AI in healthcare');
            await react(sock, msg, '🧠');
            try {
                const { data } = await axios.get('https://apis.xcasper.space/api/ai/grok', { params: { query }, timeout: 60000 });
                if (!data?.success || !data.reply) throw new Error('No reply');
                await send(sock, msg, `🧠 *Deep Think*\n\n${data.reply}\n\n💭 _Deep analysis completed_`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[think]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Deep Think service error. Please try again later.');
            }
        },
    },

    // ── VENICE ────────────────────────────────────────────────────────────────

    {
        name: 'venice',
        aliases: ['vai'],
        category: 'ai',
        description: 'Ask Venice AI a question',
        usage: '.venice <question>',
        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .venice What is life?');
            await react(sock, msg, '🌊');
            try {
                const { data } = await axios.get('https://apis.xcasper.space/api/ai/huggingface', { params: { prompt: query }, timeout: 60000 });
                if (!data?.success || !data.reply) throw new Error('No reply');
                await send(sock, msg, `🌊 *Venice AI*\n\n${data.reply}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[venice]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Venice AI service error. Please try again later.');
            }
        },
    },

    // ── PERPLEXITY ────────────────────────────────────────────────────────────

    {
        name: 'perplexity',
        aliases: [],
        category: 'ai',
        description: 'Ask Perplexity AI a question',
        usage: '.perplexity <question>',
        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .perplexity What is quantum computing?');
            await react(sock, msg, '🔎');
            try {
                const { data } = await axios.get('https://apis.xcasper.space/api/ai/grok', { params: { query }, timeout: 60000 });
                if (!data?.success || !data.reply) throw new Error('No reply');
                await send(sock, msg, `🔎 *Perplexity AI*\n\n${data.reply}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[perplexity]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Perplexity AI service error. Please try again later.');
            }
        },
    },

    // ── BARD ──────────────────────────────────────────────────────────────────

    {
        name: 'bard',
        aliases: [],
        category: 'ai',
        description: 'Ask Google Bard a question',
        usage: '.bard <question>',
        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .bard Explain black holes');
            await react(sock, msg, '✨');
            try {
                const { data } = await axios.get('https://apis.xcasper.space/api/ai/letmegpt', { params: { prompt: query }, timeout: 60000 });
                if (!data?.success || !data.reply) throw new Error('No reply');
                await send(sock, msg, `✨ *Google Bard*\n\n${data.reply}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[bard]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Bard service error. Please try again later.');
            }
        },
    },

    // ── GPT-4 NANO ────────────────────────────────────────────────────────────

    {
        name: 'gpt4nano',
        aliases: ['gpt41nano'],
        category: 'ai',
        description: 'Ask GPT-4 Nano a question',
        usage: '.gpt4nano <question>',
        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .gpt4nano Tell me a joke');
            await react(sock, msg, '🤖');
            try {
                const { data } = await axios.get('https://apis.xcasper.space/api/ai/letmegpt', { params: { prompt: query }, timeout: 60000 });
                if (!data?.success || !data.reply) throw new Error('No reply');
                await send(sock, msg, `🤖 *GPT-4 Nano*\n\n${data.reply}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[gpt4nano]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ GPT-4 Nano service error. Please try again later.');
            }
        },
    },

    // ── KELVIN AI ─────────────────────────────────────────────────────────────

    {
        name: 'kelvinai',
        aliases: [],
        category: 'ai',
        description: 'Ask Kelvin AI a question',
        usage: '.kelvinai <question>',
        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .kelvinai How does the internet work?');
            await react(sock, msg, '⚡');
            try {
                const { data } = await axios.get('https://apis.xcasper.space/api/ai/huggingface', { params: { prompt: query }, timeout: 60000 });
                if (!data?.success || !data.reply) throw new Error('No reply');
                await send(sock, msg, `⚡ *Kelvin AI*\n\n${data.reply}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[kelvinai]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Kelvin AI service error. Please try again later.');
            }
        },
    },

    // ── CLAUDE ────────────────────────────────────────────────────────────────

    {
        name: 'claude',
        aliases: [],
        category: 'ai',
        description: 'Ask Claude AI a question',
        usage: '.claude <question>',
        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .claude Explain recursion');
            await react(sock, msg, '🧠');
            try {
                const { data } = await axios.get('https://apis.xcasper.space/api/ai/cohere', { params: { prompt: query }, timeout: 60000 });
                if (!data?.success || !data.reply) throw new Error('No reply');
                await send(sock, msg, `🧠 *Claude AI*\n\n${data.reply}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[claude]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Claude service error. Please try again later.');
            }
        },
    },

    // ── GEMINI ────────────────────────────────────────────────────────────────

    {
        name: 'gemini',
        aliases: ['geminai'],
        category: 'ai',
        description: 'Ask Google Gemini a question',
        usage: '.gemini <question>',
        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .gemini Explain quantum physics');
            await react(sock, msg, '♊');
            try {
                const { data } = await axios.get('https://apis.xcasper.space/api/ai/grok', { params: { query }, timeout: 60000 });
                if (!data?.success || !data.reply) throw new Error('No reply');
                await send(sock, msg, `♊ *Google Gemini*\n\n${data.reply}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[gemini]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Gemini service error. Please try again later.');
            }
        },
    },

    // ── GLM ───────────────────────────────────────────────────────────────────

    {
        name: 'glm',
        aliases: ['glm47', 'glmflash'],
        category: 'ai',
        description: 'Ask GLM AI a question',
        usage: '.glm <question>',
        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .glm Introduction to JavaScript');
            await react(sock, msg, '💡');
            try {
                const { data } = await axios.get('https://apis.xcasper.space/api/ai/cohere', { params: { prompt: query }, timeout: 60000 });
                if (!data?.success || !data.reply) throw new Error('No reply');
                await send(sock, msg, `💡 *GLM AI*\n\n${data.reply}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[glm]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ GLM AI service error. Please try again later.');
            }
        },
    },

    // ── PHI-2 ─────────────────────────────────────────────────────────────────

    {
        name: 'phi2',
        aliases: ['phiai'],
        category: 'ai',
        description: 'Ask PHI-2 AI a question',
        usage: '.phi2 <question>',
        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .phi2 How are you?');
            await react(sock, msg, '🔬');
            try {
                const { data } = await axios.get('https://apis.xcasper.space/api/ai/huggingface', { params: { prompt: query }, timeout: 60000 });
                if (!data?.success || !data.reply) throw new Error('No reply');
                await send(sock, msg, `🔬 *PHI-2 AI*\n\n${data.reply}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[phi2]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ PHI-2 AI service error. Please try again later.');
            }
        },
    },

    // ── COMPOUND ──────────────────────────────────────────────────────────────

    {
        name: 'compound',
        aliases: ['websearch'],
        category: 'ai',
        description: 'AI with real-time web search built in',
        usage: '.compound <question>',
        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .compound Latest Node.js version');
            await react(sock, msg, '🌐');
            try {
                const { data } = await axios.get('https://apis.xcasper.space/api/ai/grok', { params: { query }, timeout: 60000 });
                if (!data?.success || !data.reply) throw new Error('No reply');
                await send(sock, msg, `🌐 *AI + Web Search*\n\n${data.reply}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[compound]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Compound AI service error. Please try again later.');
            }
        },
    },

    // ── NEWS AI ───────────────────────────────────────────────────────────────

    {
        name: 'ainews',
        aliases: ['news'],
        category: 'ai',
        description: 'Get AI-powered answers focused on latest news',
        usage: '.ainews <topic>',
        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a topic\n\nExample: .ainews latest AI developments');
            await react(sock, msg, '📰');
            try {
                const { data } = await axios.get('https://apis.xcasper.space/api/ai/grok', { params: { query: `Give me the latest news and updates about: ${query}` }, timeout: 60000 });
                if (!data?.success || !data.reply) throw new Error('No reply');
                await send(sock, msg, `📰 *News AI*\n\n${data.reply}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[ainews]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ News AI service error. Please try again later.');
            }
        },
    },

    // ── GPT-4o ────────────────────────────────────────────────────────────────

    {
        name: 'gpt4o',
        aliases: ['gpt4'],
        category: 'ai',
        description: 'Ask GPT-4o a complex question',
        usage: '.gpt4o <question>',
        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .gpt4o How does a black hole form?');
            await react(sock, msg, '🤖');
            try {
                const { data } = await axios.get('https://apis.xcasper.space/api/ai/letmegpt', { params: { prompt: query }, timeout: 60000 });
                if (!data?.success || !data.reply) throw new Error('No reply');
                await send(sock, msg, `🤖 *GPT-4o*\n\n${data.reply}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[gpt4o]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ GPT-4o service error. Please try again later.');
            }
        },
    },

    // ── SCITE ─────────────────────────────────────────────────────────────────

    {
        name: 'scite',
        aliases: ['research', 'science'],
        category: 'ai',
        description: 'AI-powered answers for research questions',
        usage: '.scite <research question>',
        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a research question\n\nExample: .scite Effects of caffeine on sleep');
            await react(sock, msg, '🔬');
            try {
                const { data } = await axios.get('https://apis.xcasper.space/api/ai/cohere', { params: { prompt: `Answer this academic/research question in detail: ${query}` }, timeout: 60000 });
                if (!data?.success || !data.reply) throw new Error('No reply');
                await send(sock, msg, `🔬 *Research AI*\n\n${data.reply}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[scite]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Research AI service error. Please try again later.');
            }
        },
    },

    // ── TEXT TO SPEECH ────────────────────────────────────────────────────────

    {
        name: 'tts',
        aliases: ['texttospeech', 'speak'],
        category: 'ai',
        description: 'Convert text to speech (returns audio)',
        usage: '.tts <text>',
        async execute(sock, msg, args, extra) {
            const text = args.join(' ').trim();
            if (!text) return extra.reply('❌ Please provide text\n\nExample: .tts Hello, how are you?');
            await react(sock, msg, '🔊');
            try {
                const audioUrl = `https://text.pollinations.ai/${encodeURIComponent(text)}?model=openai-audio&voice=nova`;
                await sock.sendMessage(extra.from, { audio: { url: audioUrl }, mimetype: 'audio/mpeg' }, { quoted: msg });
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[tts]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ TTS service error. Please try again later.');
            }
        },
    },

    // ── WHISPER ───────────────────────────────────────────────────────────────

    {
        name: 'whisper',
        aliases: ['transcribe', 'speech2text'],
        category: 'ai',
        description: 'Transcribe audio from a URL using OpenAI Whisper',
        usage: '.whisper <audio url>',
        async execute(sock, msg, args, extra) {
            const url = args[0]?.trim();
            if (!url || !url.startsWith('http')) return extra.reply('❌ Please provide an audio URL\n\nExample: .whisper https://example.com/audio.mp3');
            await react(sock, msg, '🎙️');
            try {
                const { data } = await axios.get('https://api.drexapp.space/ai/whisper', { params: { url }, timeout: 60000 });
                const text = data?.result?.text;
                if (!text) throw new Error('No transcription returned');
                await send(sock, msg, `🎙️ *Whisper Transcription*\n\n${text}\n\n_Language: ${data.result.language || 'auto'}_`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[whisper]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Whisper service error. Please try again later.');
            }
        },
    },

];
