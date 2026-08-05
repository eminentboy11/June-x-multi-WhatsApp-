/**
 * NVIDIA NIM (build.nvidia.com) helper
 * OpenAI-compatible chat + vision via https://integrate.api.nvidia.com/v1
 */

const axios = require('axios');

const BASE_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const DEFAULT_MODEL = 'nvidia/nemotron-nano-12b-v2-vl';

function getApiKey() {
  const key = process.env.NVIDIA_API_KEY || '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';
  if (!key) {
    throw new Error(
      'NVIDIA_API_KEY is not set. Get a free key at https://build.nvidia.com and add it to Replit Secrets.'
    );
  }
  return key;
}

async function callNvidia({ messages, model, maxTokens, temperature, timeoutMs }) {
  const { data } = await axios.post(
    BASE_URL,
    {
      model: model || DEFAULT_MODEL,
      messages,
      max_tokens: maxTokens ?? 2048,
      temperature: temperature ?? 0.7,
      top_p: 0.95,
      stream: false,
    },
    {
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      timeout: timeoutMs ?? 90000,
    }
  );

  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty response from NVIDIA API');
  return typeof content === 'string'
    ? content
    : content.map(c => (typeof c === 'string' ? c : c.text || '')).join('');
}

/**
 * Plain text chat
 */
async function chat(prompt, opts = {}) {
  const { model, system, maxTokens, temperature, timeoutMs } = opts;
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });
  return callNvidia({ messages, model, maxTokens, temperature, timeoutMs });
}

/**
 * Vision: prompt + image (Buffer or URL string)
 */
async function vision(prompt, image, opts = {}) {
  const { model, maxTokens, temperature, timeoutMs } = opts;

  let imageUrl;
  if (Buffer.isBuffer(image)) {
    const b64 = image.toString('base64');
    imageUrl = `data:image/jpeg;base64,${b64}`;
  } else if (typeof image === 'string') {
    imageUrl = image;
  } else {
    throw new Error('vision(): image must be a Buffer or URL string');
  }

  const messages = [
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt || 'Describe this image in detail.' },
        { type: 'image_url', image_url: { url: imageUrl } },
      ],
    },
  ];

  return callNvidia({ messages, model, maxTokens, temperature, timeoutMs });
}

module.exports = { chat, vision, DEFAULT_MODEL, BASE_URL };
