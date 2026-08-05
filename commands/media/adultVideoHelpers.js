const axios = require('axios');

const GIFTED_BASE = 'https://api.giftedtech.co.ke/api';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';

function getInput(msg, args) {
  return args.join(' ').trim()
    || msg.quoted?.text?.trim()
    || msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.conversation?.trim()
    || '';
}

function isHttpUrl(input) {
  return /^https?:\/\//i.test(input);
}

function formatDuration(seconds) {
  const value = parseInt(seconds, 10);
  if (Number.isNaN(value)) return seconds || 'N/A';
  return `${Math.floor(value / 60)}m ${value % 60}s`;
}

function safeFileName(title, fallback) {
  const cleaned = String(title || fallback).replace(/[^a-zA-Z0-9 ]/g, '').trim().slice(0, 50);
  return `${cleaned || fallback}.mp4`;
}

const MAX_VIDEO_BYTES = 64 * 1024 * 1024;

async function downloadVideoBuffer(url, timeout = 120000) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout,
    maxRedirects: 5,
    maxContentLength: MAX_VIDEO_BYTES,
    maxBodyLength: MAX_VIDEO_BYTES,
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'video/mp4,video/*;q=0.9,*/*;q=0.8',
    },
  });
  const buffer = Buffer.from(response.data);
  if (buffer.length < 5000) throw new Error('Received invalid or empty video data');
  if (buffer.length > MAX_VIDEO_BYTES) throw new Error('The video is larger than the 64 MB WhatsApp limit');
  return buffer;
}

async function fetchXvideos(url) {
  const response = await axios.get(`${GIFTED_BASE}/download/xvideosdl`, {
    params: { apikey: 'gifted', url },
    timeout: 30000,
  });
  const result = response.data?.result;
  if (!response.data?.success || !result?.download_url) return null;
  return {
    title: result.title,
    downloadUrl: result.download_url,
  };
}

async function fetchXhamster(url) {
  const response = await axios.get(`${GIFTED_BASE}/download/xhamsterdl`, {
    params: { apikey: 'gifted', url },
    timeout: 30000,
  });
  const result = response.data?.result || response.data?.data || {};
  const downloadUrl = result.download_url || result.url || result.hd || result.sd;
  if (!response.data?.success || !downloadUrl) return null;
  return { title: result.title, downloadUrl };
}

async function searchXvideos(query) {
  const response = await axios.get(`${GIFTED_BASE}/search/xvideossearch`, {
    params: { apikey: 'gifted', query },
    timeout: 20000,
  });
  return response.data?.success && response.data?.results?.[0] || null;
}

module.exports = {
  getInput,
  isHttpUrl,
  safeFileName,
  downloadVideoBuffer,
  fetchXvideos,
  fetchXhamster,
  searchXvideos,
};