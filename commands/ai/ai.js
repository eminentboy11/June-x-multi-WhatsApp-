/**
 * AI Commands — powered by api.drexapp.space
 */

const axios = require('axios');

const BASE = 'https://api.drexapp.space';

const drex = async (path, params) => {
    const { data } = await axios.get(`${BASE}${path}`, { params, timeout: 60000 });
    if (!data?.status) throw new Error(data?.error || 'API returned no result');
    return data.result;
};

// ── Shared send helpers ───────────────────────────────────────────────────────

const react = (sock, msg, emoji) =>
    sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } });

const send = (sock, msg, text) =>
    sock.sendMessage(msg.key.remoteJid, { text }, { quoted: msg });

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
            await extra.reply('⏳ *Generating image...*');

            try {
                const result = await drex('/ai/flux', { prompt });
                if (!result?.url) throw new Error('No image URL returned');

                await sock.sendMessage(extra.from, {
                    image:   { url: result.url },
                    caption: `🎨 *AI Image*\n\n_Prompt:_ ${prompt}\n> ${result.model || 'Flux'}`,
                }, { quoted: msg });
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
            await extra.reply('⏳ *Flux is generating...*');

            try {
                const result = await drex('/ai/flux', { prompt });
                if (!result?.url) throw new Error('No image URL returned');

                await sock.sendMessage(extra.from, {
                    image:   { url: result.url },
                    caption: `🌟 *Flux AI Image*\n\n_Prompt:_ ${prompt}\n> ${result.model || 'Flux'}`,
                }, { quoted: msg });
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
        description: 'Ask ChatGPT (GPT-4o-mini via DuckDuckGo) a question',
        usage: '.chatgpt <question>',

        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .chatgpt What is JavaScript?');

            await react(sock, msg, '🤖');
            await extra.reply('⏳ *ChatGPT is thinking...*');

            try {
                const result = await drex('/ai/gpt', { prompt: query });
                await send(sock, msg, `🤖 *ChatGPT*\n\n${result.response}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[chatgpt]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ ChatGPT service error. Please try again later.');
            }
        },
    },

    {
        name: 'gpt2',
        aliases: ['gptai'],
        category: 'ai',
        description: 'Ask GPT via OpenAI-compatible Pollinations endpoint',
        usage: '.gpt2 <question>',

        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .gpt2 What is artificial intelligence?');

            await react(sock, msg, '🤖');
            await extra.reply('⏳ *GPT is thinking...*');

            try {
                const result = await drex('/ai/openai', { prompt: query });
                await send(sock, msg, `🤖 *GPT Response*\n\n${result.response}\n\n_Powered by OpenAI_`);
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
            await extra.reply('⏳ *Copilot is thinking...*');

            try {
                const result = await drex('/ai/gpt', { prompt: query });
                await send(sock, msg, `🪟 *Microsoft Copilot*\n\n${result.response}`);
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
            await extra.reply('⏳ *Meta AI is thinking...*');

            try {
                const result = await drex('/ai/openai', { prompt: query });
                await send(sock, msg, `💭 *Meta AI*\n\n${result.response}`);
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
        description: 'Ask Llama 3.3 70B via Groq (ultra-fast inference)',
        usage: '.llama <question>',

        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .llama What is deep learning?');

            await react(sock, msg, '🦙');
            await extra.reply('⏳ *Llama AI is thinking...*');

            try {
                const result = await drex('/ai/groq', { q: query });
                await send(sock, msg, `🦙 *Llama 3.3 70B*\n\n${result.reply}`);
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
        description: 'Ask Blackbox AI (AI + real-time web search) a question',
        usage: '.blackbox <question>',

        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .blackbox Explain recursion');

            await react(sock, msg, '📦');
            await extra.reply('⏳ *Blackbox AI is thinking...*');

            try {
                const result = await drex('/ai/compound', { q: query });
                await send(sock, msg, `📦 *Blackbox AI*\n\n${result.reply}`);
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
            await extra.reply('⏳ *Summarizing...*');

            try {
                const result = await drex('/ai/gpt', { prompt: `Summarize the following text:\n\n${query}` });
                await send(sock, msg, `📝 *Summary*\n\n${result.response}`);
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
        description: 'Ask Mistral AI (o3-mini reasoning) a question',
        usage: '.mistral <question>',

        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .mistral What is machine learning?');

            await react(sock, msg, '🔍');
            await extra.reply('⏳ *Mistral AI is thinking...*');

            try {
                const result = await drex('/ai/o3', { prompt: query });
                await send(sock, msg, `🔍 *Mistral AI*\n\n${result.response}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[mistral]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Mistral AI service error. Please try again later.');
            }
        },
    },

    // ── THINK (DEEP REASONING) ────────────────────────────────────────────────

    {
        name: 'think',
        aliases: [],
        category: 'ai',
        description: 'Deep thinking mode powered by o3-mini reasoning',
        usage: '.think <complex question>',

        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .think Analyze the ethics of AI in healthcare');

            await react(sock, msg, '🧠');
            await extra.reply('🧠 *o3-mini is thinking deeply... This may take a moment.*');

            try {
                const result = await drex('/ai/o3', { prompt: query });
                await send(sock, msg, `🧠 *Deep Think — o3-mini*\n\n${result.response}\n\n💭 _Deep analysis completed_`);
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
        description: 'Ask Venice AI (Groq compound with web search) a question',
        usage: '.venice <question>',

        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .venice What is life?');

            await react(sock, msg, '🌊');
            await extra.reply('⏳ *Venice AI is thinking...*');

            try {
                const result = await drex('/ai/compound', { q: query });
                await send(sock, msg, `🌊 *Venice AI*\n\n${result.reply}`);
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
            await extra.reply('⏳ *Perplexity AI is searching...*');

            try {
                const result = await drex('/ai/perplexity', { q: query });
                const answer = result.answer;
                if (!answer) throw new Error('Empty response');
                await send(sock, msg, `🔎 *Perplexity AI*\n\n${answer}`);
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
        description: 'Ask Google Bard (Perplexity GPT-4o) a question',
        usage: '.bard <question>',

        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .bard Explain black holes');

            await react(sock, msg, '✨');
            await extra.reply('⏳ *Bard is thinking...*');

            try {
                const result = await drex('/ai/perplexity/gpt4o', { q: query });
                const answer = result.answer;
                if (!answer) throw new Error('Empty response');
                await send(sock, msg, `✨ *Google Bard*\n\n${answer}`);
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
            await extra.reply('⏳ *GPT-4 Nano is thinking...*');

            try {
                const result = await drex('/ai/gpt', { prompt: query });
                await send(sock, msg, `🤖 *GPT-4 Nano*\n\n${result.response}`);
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
        description: 'Ask Kelvin AI (Llama 3.3 70B Groq) a question',
        usage: '.kelvinai <question>',

        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .kelvinai How does the internet work?');

            await react(sock, msg, '⚡');
            await extra.reply('⏳ *Kelvin AI is thinking...*');

            try {
                const result = await drex('/ai/groq', { q: query });
                await send(sock, msg, `⚡ *Kelvin AI*\n\n${result.reply}`);
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
        description: 'Ask Claude 3.5 Sonnet via Perplexity a question',
        usage: '.claude <question>',

        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .claude Explain recursion');

            await react(sock, msg, '🧠');
            await extra.reply('⏳ *Claude is thinking...*');

            try {
                const result = await drex('/ai/perplexity/claude', { q: query });
                const answer = result.answer;
                if (!answer) throw new Error('Empty response');
                await send(sock, msg, `🧠 *Claude AI*\n\n${answer}`);
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
        description: 'Ask Google Gemini (OpenAI-compatible) a question',
        usage: '.gemini <question>',

        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .gemini Explain quantum physics');

            await react(sock, msg, '♊');
            await extra.reply('⏳ *Gemini is thinking...*');

            try {
                const result = await drex('/ai/openai', { prompt: query });
                await send(sock, msg, `♊ *Google Gemini*\n\n${result.response}`);
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
        description: 'Ask GLM AI (compound web search) a question',
        usage: '.glm <question>',

        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .glm Introduction to JavaScript');

            await react(sock, msg, '💡');
            await extra.reply('⏳ *GLM AI is thinking...*');

            try {
                const result = await drex('/ai/compound', { q: query });
                await send(sock, msg, `💡 *GLM AI*\n\n${result.reply}`);
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
        description: 'Ask PHI-2 AI (Llama 3.3 via Groq) a question',
        usage: '.phi2 <question>',

        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .phi2 How are you?');

            await react(sock, msg, '🔬');
            await extra.reply('⏳ *PHI-2 AI is thinking...*');

            try {
                const result = await drex('/ai/groq', { q: query });
                await send(sock, msg, `🔬 *PHI-2 AI*\n\n${result.reply}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[phi2]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ PHI-2 AI service error. Please try again later.');
            }
        },
    },

    // ── COMPOUND (AI + WEB SEARCH) ────────────────────────────────────────────

    {
        name: 'compound',
        aliases: ['websearch'],
        category: 'ai',
        description: 'AI with real-time web search built in (Groq compound-mini)',
        usage: '.compound <question>',

        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .compound Latest Node.js version');

            await react(sock, msg, '🌐');
            await extra.reply('⏳ *Searching the web + AI...*');

            try {
                const result = await drex('/ai/compound', { q: query });
                await send(sock, msg, `🌐 *AI + Web Search*\n\n${result.reply}`);
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
            await extra.reply('⏳ *Fetching latest news...*');

            try {
                const result = await drex('/ai/perplexity/news', { q: query });
                const answer = result.answer;
                if (!answer) throw new Error('Empty response');
                await send(sock, msg, `📰 *News AI*\n\n${answer}`);
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
        description: 'Ask GPT-4o via Perplexity — high accuracy complex reasoning',
        usage: '.gpt4o <question>',

        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .gpt4o How does a black hole form?');

            await react(sock, msg, '🤖');
            await extra.reply('⏳ *GPT-4o is thinking...*');

            try {
                const result = await drex('/ai/perplexity/gpt4o', { q: query });
                const answer = result.answer;
                if (!answer) throw new Error('Empty response');
                await send(sock, msg, `🤖 *GPT-4o*\n\n${answer}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[gpt4o]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ GPT-4o service error. Please try again later.');
            }
        },
    },

    // ── SCITE (RESEARCH AI) ───────────────────────────────────────────────────

    {
        name: 'scite',
        aliases: ['research', 'science'],
        category: 'ai',
        description: 'AI-powered answers backed by academic citations (Scite.ai)',
        usage: '.scite <research question>',

        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a research question\n\nExample: .scite Effects of caffeine on sleep');

            await react(sock, msg, '🔬');
            await extra.reply('⏳ *Searching academic sources...*');

            try {
                const result = await drex('/ai/scite', { q: query });
                const answer = result?.answer || result?.response || result?.reply;
                if (!answer) throw new Error('Empty response');
                await send(sock, msg, `🔬 *Research AI (Scite)*\n\n${answer}`);
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
            await extra.reply('⏳ *Converting text to speech...*');

            try {
                const result = await drex('/ai/tts', { text });
                const audioUrl = result?.url || result?.audio;
                if (!audioUrl) throw new Error('No audio URL returned');

                await sock.sendMessage(extra.from, {
                    audio:    { url: audioUrl },
                    mimetype: 'audio/mpeg',
                }, { quoted: msg });
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[tts]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ TTS service error. Please try again later.');
            }
        },
    },

    // ── WHISPER TRANSCRIBE ────────────────────────────────────────────────────

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
            await extra.reply('⏳ *Transcribing audio...*');

            try {
                const result = await drex('/ai/whisper', { url });
                const text = result?.text;
                if (!text) throw new Error('No transcription returned');
                await send(sock, msg, `🎙️ *Whisper Transcription*\n\n${text}\n\n_Language: ${result.language || 'auto'}_`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[whisper]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Whisper service error. Please try again later.');
            }
        },
    },

];
