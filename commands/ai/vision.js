/**
 * Vision Command — AI image analysis via Gemini Vision
 * Reply to an image with a question/instruction.
 *
 * Upload flow: Catbox (primary) → Ugu.se (fallback)
 * AI backend: api.bk9.dev/ai/geminiimg
 */

const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const fs   = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const { vision: nemotronVision } = require(require('path').join(global.__CORE__, 'utils', 'nvidia'));

// ── Upload helpers ────────────────────────────────────────────────────────────

async function uploadToCatbox(filePath) {
  const form = new FormData();
  form.append('reqtype', 'fileupload');
  form.append('fileToUpload', fs.createReadStream(filePath));
  const res = await axios.post('https://catbox.moe/user/api.php', form, {
    headers: form.getHeaders(),
    timeout: 30000
  });
  return res.data;
}

async function uploadToUgu(filePath) {
  const form = new FormData();
  form.append('files[]', fs.createReadStream(filePath), {
    filename: path.basename(filePath)
  });
  const res = await axios.post('https://uguu.se/upload.php', form, {
    headers: {
      ...form.getHeaders(),
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    timeout: 30000
  });
  if (res.data?.success && res.data?.files?.[0]) return res.data.files[0].url;
  throw new Error('Ugu upload failed');
}

async function uploadImage(filePath) {
  try {
    return await uploadToCatbox(filePath);
  } catch (catboxErr) {
    try {
      return await uploadToUgu(filePath);
    } catch (uguErr) {
      throw new Error(`Upload failed — Catbox: ${catboxErr.message} | Ugu: ${uguErr.message}`);
    }
  }
}

// ── Media extraction ──────────────────────────────────────────────────────────

const MEDIA_HANDLERS = {
  imageMessage:   { type: 'image',    ext: '.jpg'  },
  videoMessage:   { type: 'video',    ext: '.mp4'  },
  audioMessage:   { type: 'audio',    ext: '.mp3'  },
  documentMessage:{ type: 'document', ext: null    },
  stickerMessage: { type: 'sticker',  ext: '.webp' },
};

async function extractMedia(msgObj) {
  const m = msgObj?.message || {};
  for (const key of Object.keys(MEDIA_HANDLERS)) {
    if (!m[key]) continue;
    const { type, ext } = MEDIA_HANDLERS[key];
    const stream = await downloadContentFromMessage(m[key], type);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const resolvedExt = key === 'documentMessage'
      ? (path.extname(m.documentMessage.fileName || '') || '.bin')
      : ext;
    return { buffer: Buffer.concat(chunks), ext: resolvedExt };
  }
  return null;
}

async function extractQuotedMedia(msg) {
  const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!quoted) return null;
  return extractMedia({ message: quoted });
}

// ── Temp dir ──────────────────────────────────────────────────────────────────

const TEMP_DIR = path.join(__dirname, '../../temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// ── Command module ────────────────────────────────────────────────────────────

const VALID_IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];

module.exports = {
  name: 'vision',
  aliases: ['analyze', 'geminiimg', 'imgai', 'whatisthis'],
  category: 'ai',
  description: 'AI image analysis — reply to an image with a question',
  usage: '.vision <question>  (reply to an image)',

  async execute(sock, msg, args, extra) {
    const { from, reply } = extra;

    // Extract question from args or extended text
    const question = args.join(' ').trim();

    if (!question) {
      return reply(
        `👁️ *Vision — AI Image Analysis*\n\n` +
        `Reply to an image with a question.\n\n` +
        `*Usage:* \`.vision <question>\`\n\n` +
        `*Examples:*\n` +
        `  .vision What is in this image?\n` +
        `  .vision Describe this photo\n` +
        `  .vision What breed is this dog?\n` +
        `  .vision Read the text in this image`
      );
    }

    // Must be a reply
    const quotedMedia = await extractQuotedMedia(msg);

    if (!quotedMedia) {
      return reply('❌ Please *reply to an image* with your question.\n\nExample: Reply to a photo with `.vision What is in this image?`');
    }

    if (!VALID_IMAGE_EXTS.includes(quotedMedia.ext.toLowerCase())) {
      return reply(`❌ Unsupported media type *${quotedMedia.ext}*. Only images are supported (.jpg, .png, .webp).`);
    }

    // React to show processing
    await sock.sendMessage(from, { react: { text: '👀', key: msg.key } });

    const tempPath = path.join(TEMP_DIR, `vision_${Date.now()}${quotedMedia.ext}`);
    fs.writeFileSync(tempPath, quotedMedia.buffer);

    try {
      // Notify user
      await sock.sendMessage(from, {
        text: '🔍 _Analyzing image, please wait..._'
      }, { quoted: msg });

      let result = '';

      // Primary: Gemini Vision via bk9 (needs image URL)
      try {
        const imageUrl = await uploadImage(tempPath);
        const apiUrl   = `https://api.bk9.dev/ai/geminiimg?url=${encodeURIComponent(imageUrl)}&q=${encodeURIComponent(question)}`;
        const response = await axios.get(apiUrl, { timeout: 60000 });
        result = response.data?.BK9 || '';
        if (!result) throw new Error('Gemini returned an empty response');
      } catch (primaryErr) {
        console.warn('[Vision] primary (Gemini) failed, falling back to Nemotron VL:', primaryErr.message);
        // Fallback: NVIDIA Nemotron VL (sends raw image bytes — no upload needed)
        const nemo = await nemotronVision(question, quotedMedia.buffer, {
          maxTokens: 2048, timeoutMs: 90000,
        });
        result = String(nemo).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        if (!result) throw primaryErr;
        result = `🎨 _via Nemotron VL (fallback)_\n\n${result}`;
      }

      await sock.sendMessage(from, { text: result }, { quoted: msg });

    } catch (err) {
      console.error('[Vision] error:', err.message);

      let errorMsg = '❌ *Vision failed*';
      if (err.code === 'ECONNABORTED' || err.message.includes('timeout')) {
        errorMsg += '\n_Request timed out. Try again._';
      } else if (err.message.includes('Upload failed')) {
        errorMsg += '\n_Could not upload image to hosting service._';
      } else {
        errorMsg += `\n${err.message}`;
      }

      await reply(errorMsg);
    } finally {
      // Clean up temp file
      setTimeout(() => {
        try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
      }, 3000);
    }
  }
};
