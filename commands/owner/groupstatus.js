/**
 * Group Status — post text, image, video or audio to a group's story (WhatsApp Group Status)
 * Compatible with @whiskeysockets/baileys v7.0.0-rc.10
 */

const crypto = require('crypto');
const {
  generateWAMessageContent,
  generateWAMessageFromContent,
  downloadContentFromMessage,
} = require('@whiskeysockets/baileys');
const { PassThrough } = require('stream');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
ffmpeg.setFfmpegPath(ffmpegPath);

const PURPLE_COLOR = '#9C27B0';

module.exports = {
  name: 'groupstatus',
  aliases: ['togstatus', 'swgc', 'gs', 'gstatus'],
  description: 'Post replied media or text as a WhatsApp group status (Group Story feature).',
  usage: '.groupstatus [caption] [groupJid]  — groupJid required when used in private chat',
  category: 'owner',
  ownerOnly: true,

  async execute(sock, msg, args, extra) {
    try {
      const from = extra.from;

      // Resolve target group JID
      let targetJid = null;
      let captionArgs = [...(args || [])];

      const lastArg = captionArgs[captionArgs.length - 1] || '';
      if (lastArg.endsWith('@g.us')) {
        targetJid = lastArg;
        captionArgs = captionArgs.slice(0, -1);
      } else if (extra.isGroup) {
        targetJid = from;
      }

      if (!targetJid) {
        return extra.reply(
          '📝 *Group Status Usage*\n\n' +
          '*In a group:*\n' +
          '  `.swgc Your text here`\n' +
          '  `.swgc` (reply to image/video/audio)\n\n' +
          '*From private chat:*\n' +
          '  `.swgc Hello everyone <groupjid>`\n' +
          '  `.swgc <groupjid>` (reply to media)\n\n'
        );
      }

      const caption = captionArgs.join(' ').trim();

      // Unwrap any container (ephemeral etc.) to find contextInfo
      const ctxInfo = extractContextInfo(msg);
      const hasQuoted = !!(ctxInfo?.quotedMessage);

      // ── CASE 1: No quoted message → text group status ──────────────────────
      if (!hasQuoted) {
        if (!caption) {
          return extra.reply(
            '📝 *Group Status Usage*\n\n' +
            '*In a group:*\n' +
            '  `.swgc Your text here`\n' +
            '  `.swgc` (reply to image/video/audio)\n\n' +
            '*From private chat:*\n' +
            '  `.swgc Hello everyone <groupjid>`\n' +
            '  `.swgc <groupjid>` (reply to media)\n\n'
          );
        }
        try {
          await sendGroupStatus(sock, targetJid, {
            type: 'text',
            text: caption,
            backgroundColor: PURPLE_COLOR,
          });
          return extra.reply('✅ Text status posted!');
        } catch (e) {
          console.error('[groupstatus] text error:', e);
          return extra.reply('❌ Failed to post text status: ' + (e.message || e));
        }
      }

      // ── CASE 2: Quoted media ────────────────────────────────────────────────
      const quotedMsg = ctxInfo.quotedMessage;
      const mtype = Object.keys(quotedMsg)[0] || '';

      const targetMessage = {
        key: {
          remoteJid: from,
          id: ctxInfo.stanzaId,
          participant: ctxInfo.participant,
        },
        message: quotedMsg,
      };

      // IMAGE / STICKER
      if (/image|sticker/i.test(mtype)) {
        let buf;
        try {
          buf = await downloadMedia(quotedMsg, /sticker/i.test(mtype) ? 'sticker' : 'image');
        } catch (e) {
          return extra.reply('❌ Failed to download image: ' + e.message);
        }
        if (!buf) return extra.reply('❌ Could not download image');
        try {
          await sendGroupStatus(sock, targetJid, { type: 'image', buffer: buf, caption: caption || '' });
          return extra.reply('✅ Image status posted!');
        } catch (e) {
          console.error('[groupstatus] image error:', e);
          return extra.reply('❌ Failed to post image status: ' + (e.message || e));
        }
      }

      // VIDEO
      if (/video/i.test(mtype)) {
        let buf;
        try {
          buf = await downloadMedia(quotedMsg, 'video');
        } catch (e) {
          return extra.reply('❌ Failed to download video: ' + e.message);
        }
        if (!buf) return extra.reply('❌ Could not download video');
        try {
          await sendGroupStatus(sock, targetJid, { type: 'video', buffer: buf, caption: caption || '' });
          return extra.reply('✅ Video status posted!');
        } catch (e) {
          console.error('[groupstatus] video error:', e);
          return extra.reply('❌ Failed to post video status: ' + (e.message || e));
        }
      }

      // AUDIO
      if (/audio/i.test(mtype)) {
        let buf;
        try {
          buf = await downloadMedia(quotedMsg, 'audio');
        } catch (e) {
          return extra.reply('❌ Failed to download audio: ' + e.message);
        }
        if (!buf) return extra.reply('❌ Could not download audio');

        let vn = buf;
        try { vn = await toVN(buf); } catch (_) {}

        let waveform;
        try { waveform = await generateWaveform(buf); } catch (_) {}

        try {
          await sendGroupStatus(sock, targetJid, { type: 'audio', buffer: vn, waveform });
          return extra.reply('✅ Audio status posted!');
        } catch (e) {
          console.error('[groupstatus] audio error:', e);
          return extra.reply('❌ Failed to post audio status: ' + (e.message || e));
        }
      }

      return extra.reply('❌ Unsupported media type. Reply to an image, video, or audio.');
    } catch (e) {
      console.error('[groupstatus] outer error:', e);
      return extra.reply('❌ Error: ' + (e.message || e));
    }
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Walk through ephemeral/viewOnce wrappers and return the contextInfo
 * from whichever inner message type contains it.
 */
function extractContextInfo(msg) {
  let m = msg.message;
  if (!m) return null;

  // Unwrap common containers
  if (m.ephemeralMessage?.message)      m = m.ephemeralMessage.message;
  if (m.viewOnceMessageV2?.message)     m = m.viewOnceMessageV2.message;
  if (m.viewOnceMessage?.message)       m = m.viewOnceMessage.message;
  if (m.documentWithCaptionMessage?.message) m = m.documentWithCaptionMessage.message;

  return (
    m.extendedTextMessage?.contextInfo  ||
    m.imageMessage?.contextInfo         ||
    m.videoMessage?.contextInfo         ||
    m.audioMessage?.contextInfo         ||
    m.documentMessage?.contextInfo      ||
    m.stickerMessage?.contextInfo       ||
    null
  );
}

async function downloadMedia(quotedMsg, type) {
  // quotedMsg is the raw quoted message object e.g. { imageMessage: {...} }
  const mediaMsg = quotedMsg[`${type}Message`] || quotedMsg;
  const stream = await downloadContentFromMessage(mediaMsg, type);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/**
 * Build and send a group status (group story) message.
 *
 * Key fix for Baileys v7: generateWAMessageContent returns a proto.Message
 * object — we must NOT spread it. Instead we mutate it directly (add
 * messageContextInfo) and pass it as-is into groupStatusMessageV2.message.
 * This preserves all binary fields (mediaKey, fileEncSha256, etc.) that
 * would be lost or corrupted by JSON.parse/JSON.stringify or object spread.
 */
async function sendGroupStatus(sock, jid, content) {
  const secret = crypto.randomBytes(32);

  // Build the source content for generateWAMessageContent
  let msgContent;
  const uploadOptions = { upload: sock.waUploadToServer };

  if (content.type === 'text') {
    msgContent = { text: content.text };
    uploadOptions.backgroundColor = content.backgroundColor || PURPLE_COLOR;
  } else if (content.type === 'image') {
    msgContent = { image: content.buffer, caption: content.caption || '' };
  } else if (content.type === 'video') {
    msgContent = { video: content.buffer, caption: content.caption || '' };
  } else if (content.type === 'audio') {
    msgContent = {
      audio: content.buffer,
      mimetype: 'audio/ogg; codecs=opus',
      ptt: true,
    };
  } else {
    throw new Error('Unknown group status content type: ' + content.type);
  }

  // generateWAMessageContent handles all media uploads internally via
  // prepareWAMessageMedia — returns a live proto.Message instance.
  const innerContent = await generateWAMessageContent(msgContent, uploadOptions);

  // Inject waveform for audio (proto object allows direct property mutation)
  if (content.type === 'audio' && content.waveform && innerContent.audioMessage) {
    innerContent.audioMessage.waveform = Buffer.from(content.waveform, 'base64');
  }

  // Stamp the message secret directly onto the proto object
  innerContent.messageContextInfo = { messageSecret: secret };

  // Wrap in groupStatusMessageV2 and relay
  const outMsg = generateWAMessageFromContent(
    jid,
    {
      messageContextInfo: { messageSecret: secret },
      groupStatusMessageV2: {
        message: innerContent,
      },
    },
    {}
  );

  await sock.relayMessage(jid, outMsg.message, { messageId: outMsg.key.id });
  return outMsg;
}

// ── Audio conversion helpers ───────────────────────────────────────────────────

function toVN(buffer) {
  return new Promise((resolve, reject) => {
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks = [];
    input.end(buffer);
    ffmpeg(input)
      .noVideo()
      .audioCodec('libopus')
      .format('ogg')
      .audioChannels(1)
      .audioFrequency(48000)
      .on('error', reject)
      .on('end', () => resolve(Buffer.concat(chunks)))
      .pipe(output);
    output.on('data', (c) => chunks.push(c));
  });
}

function generateWaveform(buffer, bars = 64) {
  return new Promise((resolve, reject) => {
    const input = new PassThrough();
    input.end(buffer);
    const chunks = [];
    ffmpeg(input)
      .audioChannels(1)
      .audioFrequency(16000)
      .format('s16le')
      .on('error', reject)
      .on('end', () => {
        const raw = Buffer.concat(chunks);
        const samples = raw.length / 2;
        const amps = [];
        for (let i = 0; i < samples; i++) {
          amps.push(Math.abs(raw.readInt16LE(i * 2)) / 32768);
        }
        const size = Math.floor(amps.length / bars);
        if (size === 0) return resolve(undefined);
        const avg = Array.from({ length: bars }, (_, i) =>
          amps.slice(i * size, (i + 1) * size).reduce((a, b) => a + b, 0) / size
        );
        const max = Math.max(...avg);
        if (max === 0) return resolve(undefined);
        resolve(
          Buffer.from(avg.map((v) => Math.floor((v / max) * 100))).toString('base64')
        );
      })
      .pipe()
      .on('data', (c) => chunks.push(c));
  });
}
