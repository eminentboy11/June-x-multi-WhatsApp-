'use strict';

const BK9_URL = 'https://api.bk9.dev/ai/gemini';
const COD3_COPILOT_URL = 'https://api.cod3uchiha.com/ai/copilot';
const COD3_GPT5_URL = 'https://api.cod3uchiha.com/ai/gpt5';

// Only list models that have a real provider path in the chatbot.
// To add a future provider:
// 1. Add its key and metadata to AI_MODELS.
// 2. Add the key to MODEL_PRIORITY if it should be a fallback.
// 3. Add provider-specific request logic in commands/ai/chatbot.js,
//    or update getAIQuerySources() to send the provider's required model ID.
const AI_MODELS = {
  gpt: { name: 'GPT-compatible fallback', icon: '🤖', category: 'text' },
  'nvidia-chat': { name: 'NVIDIA Chat', icon: '🟢', category: 'text', provider: 'nvidia' }
};

const MODEL_PRIORITY = ['gpt', 'nvidia-chat'];

function getAIQuerySources(query) {
  return [
    { url: BK9_URL, params: { q: query } },
    { url: COD3_COPILOT_URL, params: { text: query } },
    { url: COD3_GPT5_URL, params: { text: query } }
  ];
}

function extractXWolfResponse(data) {
  if (!data) return null;
  if (typeof data === 'string') {
    const value = data.trim();
    return /^<!doctype|^<html/i.test(value) || value.length < 3 ? null : value;
  }
  for (const key of ['BK9', 'result', 'response', 'text', 'message', 'answer', 'content', 'output', 'reply']) {
    if (typeof data[key] === 'string' && data[key].trim()) return data[key].trim();
  }
  if (data.data && typeof data.data === 'object') return extractXWolfResponse(data.data);
  if (typeof data.data === 'string') return data.data.trim();
  return null;
}

function extractImageUrl(data) {
  if (typeof data === 'string' && /^https?:\/\//i.test(data)) return data;
  if (!data || typeof data !== 'object') return null;
  for (const key of ['url', 'image', 'image_url', 'result', 'output']) {
    const value = data[key];
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value;
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
    if (Array.isArray(value) && value[0]?.url) return value[0].url;
  }
  return null;
}

function getModelList() {
  return Object.entries(AI_MODELS).map(([key, value]) => ({
    key, name: value.name, icon: value.icon, category: value.category,
    vision: !!value.vision, provider: value.provider || 'api'
  }));
}

module.exports = {
  BK9_URL, COD3_COPILOT_URL, COD3_GPT5_URL, AI_MODELS, MODEL_PRIORITY,
  getAIQuerySources, extractXWolfResponse, extractImageUrl, getModelList
};