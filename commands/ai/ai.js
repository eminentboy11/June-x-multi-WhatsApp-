/**
 * AI Commands — Kelvin Tech
 */

const axios = require('axios');

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchJSON(url) {
    const response = await fetch(url);
    return response.json();
}

// ── Modules ───────────────────────────────────────────────────────────────────

module.exports = [

    {
        name: 'generate',
        aliases: ['genimage', 'aiimage'],
        category: 'ai',
        description: 'Generate an AI image from a text prompt',
        usage: '.generate <prompt>',

        async execute(sock, msg, args, extra) {
            const text = args.join(' ').trim();
            if (!text) return extra.reply('*Please provide text to generate image*');

            const apiUrl = `https://api.gurusensei.workers.dev/dream?prompt=${encodeURIComponent(text)}`;

            try {
                await sock.sendMessage(extra.from, { image: { url: apiUrl } }, { quoted: msg });
            } catch (error) {
                console.error('[generate] error:', error);
                extra.reply('*Failed to generate image*');
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
            if (!query) return extra.reply(`*Usage:* .copilot <question>\n*Example:* .copilot How are you?`);

            await extra.reply('⏳ *Thinking...*');
            await sock.sendMessage(extra.from, { react: { text: '🪟', key: msg.key } });

            try {
                const data = await fetchJSON(
                    `https://api.nexray.eu.cc/ai/copilot?text=${encodeURIComponent(query)}`
                );

                if (!data.status || !data.result) throw new Error('No response from API');

                await extra.reply(`🪟 *Microsoft Copilot*\n\n${data.result}`);
                await sock.sendMessage(extra.from, { react: { text: '✅', key: msg.key } });
            } catch (error) {
                console.error('[copilot] error:', error);
                await sock.sendMessage(extra.from, { react: { text: '❌', key: msg.key } });
                extra.reply(`❌ Error: ${error.message}`);
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
            if (!query) return extra.reply(`*Usage:* .chatgpt <question>\n*Example:* .chatgpt What is JavaScript?`);

            await extra.reply('⏳ *Thinking...*');
            await sock.sendMessage(extra.from, { react: { text: '🤖', key: msg.key } });

            try {
                const data = await fetchJSON(
                    `https://api.nexray.eu.cc/ai/chatgpt?text=${encodeURIComponent(query)}`
                );

                if (!data.status || !data.result) throw new Error('No response from API');

                await extra.reply(`🤖 *ChatGPT*\n\n${data.result}`);
                await sock.sendMessage(extra.from, { react: { text: '✅', key: msg.key } });
            } catch (error) {
                console.error('[chatgpt] error:', error);
                await sock.sendMessage(extra.from, { react: { text: '❌', key: msg.key } });
                extra.reply(`❌ Error: ${error.message}`);
            }
        },
    },

    {
        name: 'gpt2',
        aliases: ['giftedgpt'],
        category: 'ai',
        description: 'Ask GPT via GiftedTech API',
        usage: '.gpt2 <question>',

        async execute(sock, msg, args, extra) {
            const text = args.join(' ').trim();
            if (!text) return extra.reply(`Please provide a query/question\n\nExample: .gpt2 What is artificial intelligence?`);

            await sock.sendMessage(extra.from, { react: { text: '🤖', key: msg.key } });

            try {
                await sock.sendPresenceUpdate('composing', extra.from);

                const { data } = await axios.get(
                    `https://api.giftedtech.co.ke/api/ai/ai?apikey=gifted&q=${encodeURIComponent(text)}`
                );

                const response =
                    data?.result ||
                    data?.message ||
                    "❌ Sorry, I couldn't process your request at the moment. Please try again later.";

                await extra.reply(`🤖 *GPT RESPONSE*\n\n${response}\n\n*Powered by GiftedTech AI*`);
                await sock.sendMessage(extra.from, { react: { text: '✅', key: msg.key } });
            } catch (error) {
                console.error('[gpt2] error:', error);
                await sock.sendMessage(extra.from, { react: { text: '❌', key: msg.key } });
                extra.reply('❌ An error occurred while processing your request. Please try again later.');
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
            const text = args.join(' ').trim();
            if (!text) return extra.reply(`❌ *Please provide a question!*\n\n📌 *Example:* .metaai Hello, how are you?`);

            await sock.sendMessage(extra.from, { react: { text: '💭', key: msg.key } });

            try {
                const data = await fetchJSON(
                    `https://api.nekolabs.web.id/text-generation/ai4chat?text=${encodeURIComponent(text)}`
                );

                if (!data.success || !data.result) throw new Error('No response from AI');

                await sock.sendMessage(
                    extra.from,
                    { text: `💭 *Meta AI*\n\n${data.result}\n\n⏱️ *Response Time:* ${data.responseTime || 'N/A'}` },
                    { quoted: msg }
                );

                await sock.sendMessage(extra.from, { react: { text: '✅', key: msg.key } });
            } catch (error) {
                console.error('[metaai] error:', error);
                await sock.sendMessage(extra.from, { react: { text: '❌', key: msg.key } });
                extra.reply('❌ *Failed to get AI response. Please try again later.*');
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
            if (!query) return extra.reply('*Please ask me something*');

            await extra.reply('⏳ *Llama AI is thinking...*');
            await sock.sendMessage(extra.from, { react: { text: '🦙', key: msg.key } });

            try {
                const data = await fetchJSON(
                    `https://api.privatezia.biz.id/api/ai/deepai?query=${encodeURIComponent(query)}`
                );

                if (!data.status || !data.data) throw new Error('No response from Llama AI');

                await extra.reply(`🦙 *Llama AI*\n\n${data.data}`);
                await sock.sendMessage(extra.from, { react: { text: '✅', key: msg.key } });
            } catch (error) {
                console.error('[llama] error:', error);
                await sock.sendMessage(extra.from, { react: { text: '❌', key: msg.key } });
                extra.reply('⚠️ Error processing your request');
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
            if (!query) return extra.reply('*Please ask me something*');

            await extra.reply('⏳ *Blackbox AI is thinking...*');
            await sock.sendMessage(extra.from, { react: { text: '📦', key: msg.key } });

            try {
                const data = await fetchJSON(
                    `https://api.privatezia.biz.id/api/ai/blackbox?query=${encodeURIComponent(query)}`
                );

                if (!data.status || !data.data) throw new Error('No response from Blackbox AI');

                await extra.reply(`📦 *Blackbox AI*\n\n${data.data}`);
                await sock.sendMessage(extra.from, { react: { text: '✅', key: msg.key } });
            } catch (error) {
                console.error('[blackbox] error:', error);
                await sock.sendMessage(extra.from, { react: { text: '❌', key: msg.key } });
                extra.reply('⚠️ Error processing your request');
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
            if (!query) return extra.reply('*Please ask me something*');

            await extra.reply('⏳ *LuminAI is thinking...*');
            await sock.sendMessage(extra.from, { react: { text: '🌟', key: msg.key } });

            try {
                const data = await fetchJSON(
                    `https://api.privatezia.biz.id/api/ai/luminai?query=${encodeURIComponent(query)}`
                );

                if (!data.status || !data.data) throw new Error('No response from LuminAI');

                await extra.reply(`🌟 *LuminAI*\n\n${data.data}`);
                await sock.sendMessage(extra.from, { react: { text: '✅', key: msg.key } });
            } catch (error) {
                console.error('[dalle] error:', error);
                await sock.sendMessage(extra.from, { react: { text: '❌', key: msg.key } });
                extra.reply('⚠️ Error processing your request');
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
            if (!query) return extra.reply('*Please provide text to summarize*');

            await extra.reply('⏳ *Summarizing...*');
            await sock.sendMessage(extra.from, { react: { text: '📝', key: msg.key } });

            try {
                const data = await fetchJSON(
                    `https://api.privatezia.biz.id/api/ai/ai4chat?query=${encodeURIComponent(query)}`
                );

                if (!data.status || !data.data) throw new Error('No response from AI');

                await extra.reply(`📝 *Summary*\n\n${data.data}`);
                await sock.sendMessage(extra.from, { react: { text: '✅', key: msg.key } });
            } catch (error) {
                console.error('[summarize] error:', error);
                await sock.sendMessage(extra.from, { react: { text: '❌', key: msg.key } });
                extra.reply('⚠️ Error processing your request');
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
            if (!query) return extra.reply('❌ Ask me something\n\nExample: .mistral What is machine learning?');

            await extra.reply('⏳ *Mistral AI is thinking...*');
            await sock.sendMessage(extra.from, { react: { text: '🔍', key: msg.key } });

            try {
                const data = await fetchJSON(
                    `https://api.giftedtech.co.ke/api/ai/deepseek-r1?apikey=gifted&q=${encodeURIComponent(query)}`
                );

                if (!data.success || !data.result) throw new Error('No response from Mistral');

                await extra.reply(`🔍 *Mistral AI*\n\n${data.result}`);
                await sock.sendMessage(extra.from, { react: { text: '✅', key: msg.key } });
            } catch (error) {
                console.error('[mistral] error:', error);
                await sock.sendMessage(extra.from, { react: { text: '❌', key: msg.key } });
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
            if (!query) {
                return extra.reply(
                    'Please provide a complex question for deep thinking mode.\n\n' +
                    'Example: .think analyze the ethical implications of artificial intelligence in healthcare'
                );
            }

            await extra.reply('🧠 Microsoft Copilot is thinking deeply... This may take a moment.');
            await sock.sendMessage(extra.from, { react: { text: '🧠', key: msg.key } });

            try {
                const response = await axios.get(
                    `https://malvin-api.vercel.app/ai/copilot-think?text=${encodeURIComponent(query)}`
                );

                if (!response.data?.result) throw new Error('Invalid response from Copilot Deep Thinking API');

                await sock.sendMessage(
                    extra.from,
                    { text: `🧠 *Microsoft Copilot - Deep Thinking:*\n\n${response.data.result}\n\n💭 *Deep analysis completed*` },
                    { quoted: msg }
                );

                await sock.sendMessage(extra.from, { react: { text: '✅', key: msg.key } });
            } catch (error) {
                console.error('[think] error:', error);
                await sock.sendMessage(extra.from, { react: { text: '❌', key: msg.key } });

                if (error.code === 'ECONNABORTED') {
                    extra.reply('❌ Request timeout. Please try again.');
                } else if (error.response?.status === 429) {
                    extra.reply('❌ Rate limit exceeded. Please wait before trying again.');
                } else {
                    extra.reply('❌ Failed to get deep thinking response. Please try again later.');
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
            if (!query) return extra.reply('❌ Ask me something\n\nExample: .venice What is life?');

            await extra.reply('⏳ *Venice AI is thinking...*');
            await sock.sendMessage(extra.from, { react: { text: '🌊', key: msg.key } });

            try {
                const data = await fetchJSON(
                    `https://api.giftedtech.co.ke/api/ai/venice?apikey=gifted&q=${encodeURIComponent(query)}`
                );

                if (!data.success || !data.result) throw new Error('No response from Venice AI');

                await extra.reply(`🌊 *Venice AI*\n\n${data.result}`);
                await sock.sendMessage(extra.from, { react: { text: '✅', key: msg.key } });
            } catch (error) {
                console.error('[venice] error:', error);
                await sock.sendMessage(extra.from, { react: { text: '❌', key: msg.key } });
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
            if (!query) return extra.reply('❌ Ask me something\n\nExample: .perplexity What is quantum computing?');

            await extra.reply('⏳ *Perplexity AI is searching...*');
            await sock.sendMessage(extra.from, { react: { text: '🔎', key: msg.key } });

            try {
                const data = await fetchJSON(
                    `https://api.giftedtech.co.ke/api/ai/perplexity?apikey=gifted&q=${encodeURIComponent(query)}`
                );

                if (!data.success || !data.result) throw new Error('No response from Perplexity AI');

                await extra.reply(`🔎 *Perplexity AI*\n\n${data.result}`);
                await sock.sendMessage(extra.from, { react: { text: '✅', key: msg.key } });
            } catch (error) {
                console.error('[perplexity] error:', error);
                await sock.sendMessage(extra.from, { react: { text: '❌', key: msg.key } });
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
            if (!query) return extra.reply('❌ Ask me something\n\nExample: .bard Explain black holes');

            await extra.reply('⏳ *Bard is thinking...*');
            await sock.sendMessage(extra.from, { react: { text: '✨', key: msg.key } });

            try {
                const data = await fetchJSON(
                    `https://api.giftedtech.co.ke/api/ai/bard?apikey=gifted&q=${encodeURIComponent(query)}`
                );

                if (!data.success || !data.result) throw new Error('No response from Bard');

                await extra.reply(`✨ *Google Bard*\n\n${data.result}`);
                await sock.sendMessage(extra.from, { react: { text: '✅', key: msg.key } });
            } catch (error) {
                console.error('[bard] error:', error);
                await sock.sendMessage(extra.from, { react: { text: '❌', key: msg.key } });
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
            if (!query) return extra.reply('❌ Ask me something\n\nExample: .gpt4nano Tell me a joke');

            await extra.reply('⏳ *GPT-4 Nano is thinking...*');
            await sock.sendMessage(extra.from, { react: { text: '🤖', key: msg.key } });

            try {
                const data = await fetchJSON(
                    `https://api.giftedtech.co.ke/api/ai/gpt4nano?apikey=gifted&q=${encodeURIComponent(query)}`
                );

                if (!data.success || !data.result) throw new Error('No response from GPT-4 Nano');

                await extra.reply(`🤖 *GPT-4 Nano*\n\n${data.result}`);
                await sock.sendMessage(extra.from, { react: { text: '✅', key: msg.key } });
            } catch (error) {
                console.error('[gpt4nano] error:', error);
                await sock.sendMessage(extra.from, { react: { text: '❌', key: msg.key } });
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
            if (!query) return extra.reply('❌ Ask me something\n\nExample: .kelvinai How does the internet work?');

            await extra.reply('⏳ *Kelvin AI is thinking...*');
            await sock.sendMessage(extra.from, { react: { text: '⚡', key: msg.key } });

            try {
                const data = await fetchJSON(
                    `https://api.giftedtech.co.ke/api/ai/ai?apikey=gifted&q=${encodeURIComponent(query)}`
                );

                if (!data.success || !data.result) throw new Error('No response from Kelvin AI');

                await extra.reply(`⚡ *Kelvin AI*\n\n${data.result}`);
                await sock.sendMessage(extra.from, { react: { text: '✅', key: msg.key } });
            } catch (error) {
                console.error('[kelvinai] error:', error);
                await sock.sendMessage(extra.from, { react: { text: '❌', key: msg.key } });
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
            if (!query) return extra.reply('❌ Ask me something\n\nExample: .claude Explain recursion');

            await extra.reply('⏳ *Claude is thinking...*');
            await sock.sendMessage(extra.from, { react: { text: '🧠', key: msg.key } });

            try {
                const data = await fetchJSON(
                    `https://api.giftedtech.co.ke/api/ai/claude?apikey=gifted&q=${encodeURIComponent(query)}`
                );

                if (!data.success || !data.result) throw new Error('No response from Claude');

                await extra.reply(`🧠 *Claude AI*\n\n${data.result}`);
                await sock.sendMessage(extra.from, { react: { text: '✅', key: msg.key } });
            } catch (error) {
                console.error('[claude] error:', error);
                await sock.sendMessage(extra.from, { react: { text: '❌', key: msg.key } });
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
            const text = args.join(' ').trim();
            if (!text) return extra.reply('*Please provide a question. Example: `.gemini Explain quantum physics`*');

            await extra.reply('🤔 Thinking...');
            await sock.sendMessage(extra.from, { react: { text: '♊', key: msg.key } });

            try {
                const data = await fetchJSON(
                    `https://api.giftedtech.co.ke/api/ai/gemini?apikey=gifted&q=${encodeURIComponent(text)}`
                );

                if (!data.success || !data.result) throw new Error('No response from Gemini');

                await extra.reply(`♊ *Google Gemini*\n\n${data.result}`);
                await sock.sendMessage(extra.from, { react: { text: '✅', key: msg.key } });
            } catch (error) {
                console.error('[gemini] error:', error);
                await sock.sendMessage(extra.from, { react: { text: '❌', key: msg.key } });
                extra.reply('❌ Error communicating with Gemini AI.');
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
            const text = args.join(' ').trim();
            if (!text) return extra.reply('*Please provide a question. Example: `.glm Introduction to JavaScript`*');

            await extra.reply('🤔 Thinking...');
            await sock.sendMessage(extra.from, { react: { text: '💡', key: msg.key } });

            try {
                const data = await fetchJSON(
                    `https://api.privatezia.biz.id/api/ai/ai4chat?query=${encodeURIComponent(text)}`
                );

                if (!data.status || !data.data) throw new Error('No response from GLM');

                await extra.reply(`💡 *GLM AI*\n\n${data.data}`);
                await sock.sendMessage(extra.from, { react: { text: '✅', key: msg.key } });
            } catch (error) {
                console.error('[glm] error:', error);
                await sock.sendMessage(extra.from, { react: { text: '❌', key: msg.key } });
                extra.reply('❌ Error communicating with GLM AI.');
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
            const text = args.join(' ').trim();
            if (!text) return extra.reply('*Please provide a question. Example: `.phi2 How are you`*');

            await extra.reply('🤔 Thinking...');
            await sock.sendMessage(extra.from, { react: { text: '🔬', key: msg.key } });

            try {
                const data = await fetchJSON(
                    `https://api.privatezia.biz.id/api/ai/deepai?query=${encodeURIComponent(text)}`
                );

                if (!data.status || !data.data) throw new Error('No response from PHI2');

                await extra.reply(`🔬 *PHI-2 AI*\n\n${data.data}`);
                await sock.sendMessage(extra.from, { react: { text: '✅', key: msg.key } });
            } catch (error) {
                console.error('[phi2] error:', error);
                await sock.sendMessage(extra.from, { react: { text: '❌', key: msg.key } });
                extra.reply('❌ Error communicating with PHI2 AI.');
            }
        },
    },
];
