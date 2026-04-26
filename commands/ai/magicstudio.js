const axios = require('axios');
const { chat: nemotronChat } = require('../../utils/nvidia');

module.exports = {
  name: 'imagine',
  aliases: ['magic', 'magicai', 'magicstudio', 'generate'],
  category: 'ai',
  desc: 'Generate AI art from text prompt',
  usage: '.imagine <prompt>',
  execute: async (sock, msg, args, extra) => {
    const prompt = args.join(' ').trim();
    if (!prompt) {
      return await extra.reply('Usage: .imagine <prompt>\n\nExample: .imagine a cyberpunk city at night');
    }

    await extra.react('🎨');

    // ── Primary: MagicStudio image generation ──────────────────────────────
    try {
      const response = await axios.get('https://apiskeith.top/ai/magicstudio', {
        params: { prompt },
        responseType: 'arraybuffer',
        timeout: 120000,
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': '*/*' }
      });

      const imageBuffer = Buffer.from(response.data);
      if (!imageBuffer || imageBuffer.length === 0) throw new Error('Empty response from API');

      // Detect HTML/JSON error responses returned with 200
      const head = imageBuffer.slice(0, 16).toString('utf8').toLowerCase();
      if (head.includes('<!doctype') || head.includes('<html') || head.startsWith('{"status":false')) {
        throw new Error('API returned non-image response');
      }

      return await sock.sendMessage(extra.from, {
        image: imageBuffer,
        caption: `🎨 *Generated:* ${prompt}`
      }, { quoted: msg });

    } catch (primaryErr) {
      const isRate    = primaryErr.response?.status === 429;
      const isTimeout = primaryErr.code === 'ECONNABORTED' || /timeout/i.test(primaryErr.message);
      console.warn('[imagine] primary failed, trying Nemotron text fallback:', primaryErr.message);

      // ── Fallback: Nemotron — vivid text description of the image ──────────
      try {
        const desc = await nemotronChat(
          `The user wants the image: "${prompt}". Image generation is currently unavailable, so write a vivid, cinematic, paragraph-length visual description (200-350 words) of exactly what that image would look like — composition, lighting, colors, mood, style. No preamble, no apologies, just the description.`,
          {
            system: 'You are a visual concept artist who paints pictures with words.',
            maxTokens: 700,
            timeoutMs: 60000,
          }
        );

        let text = String(desc).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        if (!text) throw new Error('Empty Nemotron response');

        const header = isRate
          ? '⚠️ *Image generator hit rate limit — describing it instead via Nemotron VL:*'
          : isTimeout
          ? '⚠️ *Image generator timed out — describing it instead via Nemotron VL:*'
          : '⚠️ *Image generator failed — describing it instead via Nemotron VL:*';

        return await sock.sendMessage(extra.from, {
          text: `${header}\n\n🎨 *Prompt:* ${prompt}\n━━━━━━━━━━━━━━━\n${text}`
        }, { quoted: msg });

      } catch (fallbackErr) {
        console.error('[imagine] fallback also failed:', fallbackErr.message);
        if (isRate) {
          return await extra.reply('❌ Rate limit exceeded and Nemotron fallback failed. Please try again later.');
        }
        if (isTimeout) {
          return await extra.reply('❌ Image generation timed out and Nemotron fallback failed. Try again.');
        }
        return await extra.reply(`❌ Failed to generate image: ${primaryErr.message}\n_Fallback also failed: ${fallbackErr.message}_`);
      }
    }
  }
};
