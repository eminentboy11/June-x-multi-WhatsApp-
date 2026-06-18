const axios = require('axios');
const config = require('../../config');
const { applyFont } = require('../../utils/fontConverter');

const POLLINATIONS_BASE = 'https://image.pollinations.ai/prompt';
const MAX_IMAGES = 5;
const DEFAULT_SIZE = 1024;

function buildImageUrl(prompt, seed, width, height) {
    const encodedPrompt = encodeURIComponent(prompt);
    return `${POLLINATIONS_BASE}/${encodedPrompt}?width=${width}&height=${height}&seed=${seed}&nologo=true&model=flux`;
}

async function fetchImage(prompt, seed, width, height) {
    const url = buildImageUrl(prompt, seed, width, height);
    const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 60000
    });
    return Buffer.from(response.data);
}

module.exports = {
    name: 'image',
    aliases: ['imag', 'img', 'imgs', 'images'],
    description: `Generate AI images from a text prompt using Pollinations AI (sends ${MAX_IMAGES} by default)`,
    category: 'general',
    async execute(sock, msg, args, extra) {
        const { from, reply, react, quoted } = extra;

        if (!args.length) {
            return reply(
                `🎨 *${config.botName} Image Generator*\n\n` +
                `Usage: ${config.prefix}image <prompt> [count]\n\n` +
                `Example:\n${config.prefix}image cat\n${config.prefix}image cat 2\n\n` +
                `_Defaults to ${MAX_IMAGES} images. Add a number at the end to send fewer (max ${MAX_IMAGES})._`
            );
        }

        // If the last arg is a plain number, treat it as the image count.
        // Otherwise default to sending the max.
        let count = MAX_IMAGES;
        let promptArgs = args;
        const lastArg = args[args.length - 1];
        if (/^\d+$/.test(lastArg)) {
            count = parseInt(lastArg, 10);
            promptArgs = args.slice(0, -1);
        }
        count = Math.min(Math.max(count, 1), MAX_IMAGES);

        const prompt = promptArgs.join(' ').trim();
        if (!prompt) {
            return reply(`❌ Please provide a prompt to generate an image.\n\nUsage: ${config.prefix}image <prompt> [count]`);
        }

        await react('⏳');

        try {
            // Different random seeds so each request returns a distinct image
            const seeds = Array.from({ length: count }, () => Math.floor(Math.random() * 1_000_000));

            const results = await Promise.allSettled(
                seeds.map(seed => fetchImage(prompt, seed, DEFAULT_SIZE, DEFAULT_SIZE))
            );

            const buffers = results
                .filter(r => r.status === 'fulfilled')
                .map(r => r.value);

            if (!buffers.length) {
                await react('❌');
                return reply('❌ Failed to generate image(s). The Pollinations API may be temporarily unavailable — try again shortly.');
            }

            for (let i = 0; i < buffers.length; i++) {
                await sock.sendMessage(
                    from,
                    {
                        image: buffers[i],
                        caption: applyFont(`🎨 ${prompt}\n\n${config.botName} • ${i + 1}/${buffers.length}`)
                    },
                    { quoted: quoted || msg }
                );
            }

            if (buffers.length < count) {
                await reply(`⚠️ Only ${buffers.length}/${count} image(s) generated successfully.`);
            }

            await react('✅');
        } catch (err) {
            console.error('[imagine] Error:', err);
            await react('❌');
            await reply('❌ An error occurred while generating the image(s). Please try again.');
        }
    }
};
