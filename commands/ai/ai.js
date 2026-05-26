/**
 * AI Commands
 */

const axios = require('axios');

const fetchJSON = async (url) => (await fetch(url)).json();

// ── Shared send helpers ───────────────────────────────────────────────────────

const react = (sock, msg, emoji) =>
    sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } });

const send = (sock, msg, text) =>
    sock.sendMessage(msg.key.remoteJid, { text }, { quoted: msg });

// ── Commands ──────────────────────────────────────────────────────────────────

module.exports = [

    {
        name: 'generate',
        aliases: ['genimage', 'aiimage'],
        category: 'ai',
        description: 'Generate an AI image from a text prompt',
        usage: '.generate <prompt>',

        async execute(sock, msg, args, extra) {
            const text = args.join(' ').trim();
            if (!text) return extra.reply('❌ Please provide a prompt\n\nExample: .generate sunset over mountains');

            try {
                const url = `https://api.gurusensei.workers.dev/dream?prompt=${encodeURIComponent(text)}`;
                await sock.sendMessage(extra.from, { image: { url } }, { quoted: msg });
            } catch (err) {
                console.error('[generate]', err.message);
                extra.reply('❌ Failed to generate image. Please try again.');
            }
        },
    },

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
                const data = await fetchJSON(
                    `https://api.nexray.eu.cc/ai/copilot?text=${encodeURIComponent(query)}`
                );
                if (!data.status || !data.result) throw new Error('Empty response');

                await send(sock, msg, `🪟 *Microsoft Copilot*\n\n${data.result}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[copilot]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Copilot service error. Please try again later.');
            }
        },
    },

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
            await extra.reply('⏳ *ChatGPT is thinking...*');

            try {
                const data = await fetchJSON(
                    `https://api.nexray.eu.cc/ai/chatgpt?text=${encodeURIComponent(query)}`
                );
                if (!data.status || !data.result) throw new Error('Empty response');

                await send(sock, msg, `🤖 *ChatGPT*\n\n${data.result}`);
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
        description: 'Ask GPT via Wolf-Tech API',
        usage: '.gpt2 <question>',

        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .gpt2 What is artificial intelligence?');

            await react(sock, msg, '🤖');
            await sock.sendPresenceUpdate('composing', extra.from);

            try {
                const { data } = await axios.get(
                    `https://apis.xwolf.space/api/ai/gpt?q=${encodeURIComponent(query)}`
                );
                const result = data?.result || '❌ No response received.';

                await send(sock, msg, `🤖 *GPT Response*\n\n${result}\n\n_Powered by Wolf-Tech AI_`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[gpt2]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ GPT service error. Please try again later.');
            }
        },
    },

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
                const data = await fetchJSON(
                    `https://api.nekolabs.web.id/text-generation/ai4chat?text=${encodeURIComponent(query)}`
                );
                if (!data.success || !data.result) throw new Error('Empty response');

                await send(sock, msg, `💭 *Meta AI*\n\n${data.result}\n\n⏱️ *Response Time:* ${data.responseTime || 'N/A'}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[metaai]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Meta AI service error. Please try again later.');
            }
        },
    },

    {
        name: 'llama',
        aliases: ['llamaai'],
        category: 'ai',
        description: 'Ask Llama AI a question',
        usage: '.llama <question>',

        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .llama What is deep learning?');

            await react(sock, msg, '🦙');
            await extra.reply('⏳ *Llama AI is thinking...*');

            try {
                const data = await fetchJSON(
                    `https://api.privatezia.biz.id/api/ai/deepai?query=${encodeURIComponent(query)}`
                );
                if (!data.status || !data.data) throw new Error('Empty response');

                await send(sock, msg, `🦙 *Llama AI*\n\n${data.data}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[llama]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Llama AI service error. Please try again later.');
            }
        },
    },

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
            await extra.reply('⏳ *Blackbox AI is thinking...*');

            try {
                const data = await fetchJSON(
                    `https://api.privatezia.biz.id/api/ai/blackbox?query=${encodeURIComponent(query)}`
                );
                if (!data.status || !data.data) throw new Error('Empty response');

                await send(sock, msg, `📦 *Blackbox AI*\n\n${data.data}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[blackbox]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Blackbox AI service error. Please try again later.');
            }
        },
    },

    {
        name: 'dalle',
        aliases: ['luminai'],
        category: 'ai',
        description: 'Ask LuminAI a question',
        usage: '.dalle <question>',

        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .dalle What is the universe?');

            await react(sock, msg, '🌟');
            await extra.reply('⏳ *LuminAI is thinking...*');

            try {
                const data = await fetchJSON(
                    `https://api.privatezia.biz.id/api/ai/luminai?query=${encodeURIComponent(query)}`
                );
                if (!data.status || !data.data) throw new Error('Empty response');

                await send(sock, msg, `🌟 *LuminAI*\n\n${data.data}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[dalle]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ LuminAI service error. Please try again later.');
            }
        },
    },

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
                const data = await fetchJSON(
                    `https://api.privatezia.biz.id/api/ai/ai4chat?query=${encodeURIComponent(query)}`
                );
                if (!data.status || !data.data) throw new Error('Empty response');

                await send(sock, msg, `📝 *Summary*\n\n${data.data}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[summarize]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Summarize service error. Please try again later.');
            }
        },
    },

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
            await extra.reply('⏳ *Mistral AI is thinking...*');

            try {
                const data = await fetchJSON(
                    `https://api.giftedtech.co.ke/api/ai/deepseek-r1?apikey=gifted&q=${encodeURIComponent(query)}`
                );
                if (!data.success || !data.result) throw new Error('Empty response');

                await send(sock, msg, `🔍 *Mistral AI*\n\n${data.result}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[mistral]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Mistral AI service error. Please try again later.');
            }
        },
    },

    {
        name: 'think',
        aliases: [],
        category: 'ai',
        description: 'Deep thinking mode powered by Microsoft Copilot',
        usage: '.think <complex question>',

        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .think Analyze the ethics of AI in healthcare');

            await react(sock, msg, '🧠');
            await extra.reply('🧠 *Copilot is thinking deeply... This may take a moment.*');

            try {
                const { data } = await axios.get(
                    `https://malvin-api.vercel.app/ai/copilot-think?text=${encodeURIComponent(query)}`
                );
                if (!data?.result) throw new Error('Empty response');

                await send(sock, msg, `🧠 *Microsoft Copilot — Deep Think*\n\n${data.result}\n\n💭 _Deep analysis completed_`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[think]', err.message);
                await react(sock, msg, '❌');
                if (err.code === 'ECONNABORTED') {
                    extra.reply('❌ Request timed out. Please try again.');
                } else if (err.response?.status === 429) {
                    extra.reply('❌ Rate limit exceeded. Please wait before trying again.');
                } else {
                    extra.reply('❌ Deep Think service error. Please try again later.');
                }
            }
        },
    },

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
            await extra.reply('⏳ *Venice AI is thinking...*');

            try {
                const data = await fetchJSON(
                    `https://api.giftedtech.co.ke/api/ai/venice?apikey=gifted&q=${encodeURIComponent(query)}`
                );
                if (!data.success || !data.result) throw new Error('Empty response');

                await send(sock, msg, `🌊 *Venice AI*\n\n${data.result}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[venice]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Venice AI service error. Please try again later.');
            }
        },
    },

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
                const data = await fetchJSON(
                    `https://api.giftedtech.co.ke/api/ai/perplexity?apikey=gifted&q=${encodeURIComponent(query)}`
                );
                if (!data.success || !data.result) throw new Error('Empty response');

                await send(sock, msg, `🔎 *Perplexity AI*\n\n${data.result}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[perplexity]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Perplexity AI service error. Please try again later.');
            }
        },
    },

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
            await extra.reply('⏳ *Bard is thinking...*');

            try {
                const data = await fetchJSON(
                    `https://api.giftedtech.co.ke/api/ai/bard?apikey=gifted&q=${encodeURIComponent(query)}`
                );
                if (!data.success || !data.result) throw new Error('Empty response');

                await send(sock, msg, `✨ *Google Bard*\n\n${data.result}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[bard]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Bard service error. Please try again later.');
            }
        },
    },

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
                const data = await fetchJSON(
                    `https://api.giftedtech.co.ke/api/ai/gpt4nano?apikey=gifted&q=${encodeURIComponent(query)}`
                );
                if (!data.success || !data.result) throw new Error('Empty response');

                await send(sock, msg, `🤖 *GPT-4 Nano*\n\n${data.result}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[gpt4nano]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ GPT-4 Nano service error. Please try again later.');
            }
        },
    },

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
            await extra.reply('⏳ *Kelvin AI is thinking...*');

            try {
                const data = await fetchJSON(
                    `https://api.giftedtech.co.ke/api/ai/ai?apikey=gifted&q=${encodeURIComponent(query)}`
                );
                if (!data.success || !data.result) throw new Error('Empty response');

                await send(sock, msg, `⚡ *Kelvin AI*\n\n${data.result}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[kelvinai]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Kelvin AI service error. Please try again later.');
            }
        },
    },

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
            await extra.reply('⏳ *Claude is thinking...*');

            try {
                const data = await fetchJSON(
                    `https://api.giftedtech.co.ke/api/ai/claude?apikey=gifted&q=${encodeURIComponent(query)}`
                );
                if (!data.success || !data.result) throw new Error('Empty response');

                await send(sock, msg, `🧠 *Claude AI*\n\n${data.result}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[claude]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Claude service error. Please try again later.');
            }
        },
    },

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
            await extra.reply('⏳ *Gemini is thinking...*');

            try {
                const data = await fetchJSON(
                    `https://api.giftedtech.co.ke/api/ai/gemini?apikey=gifted&q=${encodeURIComponent(query)}`
                );
                if (!data.success || !data.result) throw new Error('Empty response');

                await send(sock, msg, `♊ *Google Gemini*\n\n${data.result}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[gemini]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ Gemini service error. Please try again later.');
            }
        },
    },

    {
        name: 'glm',
        aliases: ['glm47', 'glmflash'],
        category: 'ai',
        description: 'Ask GLM-4 Flash a question',
        usage: '.glm <question>',

        async execute(sock, msg, args, extra) {
            const query = args.join(' ').trim();
            if (!query) return extra.reply('❌ Please provide a question\n\nExample: .glm Introduction to JavaScript');

            await react(sock, msg, '💡');
            await extra.reply('⏳ *GLM AI is thinking...*');

            try {
                const data = await fetchJSON(
                    `https://api.privatezia.biz.id/api/ai/ai4chat?query=${encodeURIComponent(query)}`
                );
                if (!data.status || !data.data) throw new Error('Empty response');

                await send(sock, msg, `💡 *GLM AI*\n\n${data.data}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[glm]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ GLM AI service error. Please try again later.');
            }
        },
    },

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
            await extra.reply('⏳ *PHI-2 AI is thinking...*');

            try {
                const data = await fetchJSON(
                    `https://api.privatezia.biz.id/api/ai/deepai?query=${encodeURIComponent(query)}`
                );
                if (!data.status || !data.data) throw new Error('Empty response');

                await send(sock, msg, `🔬 *PHI-2 AI*\n\n${data.data}`);
                await react(sock, msg, '✅');
            } catch (err) {
                console.error('[phi2]', err.message);
                await react(sock, msg, '❌');
                extra.reply('❌ PHI-2 AI service error. Please try again later.');
            }
        },
    },

];
