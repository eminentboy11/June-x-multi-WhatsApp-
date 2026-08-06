/**
 * groupstatus.js — Post group stories (WhatsApp Group Status)
 * Compatible with @whiskeysockets/baileys 7.0.0-rc14
 *
 * Commands: .groupstatus / .togstatus / .swgc / .gs / .gstatus
 *
 * Media strategy:
 *   Image / Sticker / Video — reuse the existing CDN URL + mediaKey from the
 *     quoted message proto. No re-download, no re-upload. The WhatsApp CDN
 *     serves media to anyone who has the URL + decryption key; recipients get
 *     both from the message proto, so this works correctly.
 *   Audio — must download because group-status audio must be OGG/Opus (PTT).
 *     If the quoted audio is already OGG/Opus we reuse it; otherwise we
 *     download, convert with ffmpeg, then upload.
 *   Text — generateWAMessageContent with no upload (unchanged path).
 */

'use strict';

const crypto = require('crypto');
const { PassThrough } = require('stream');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('../../utils/ffmpegPath');
ffmpeg.setFfmpegPath(ffmpegPath);

const PURPLE_COLOR = '#9C27B0';

// ── Baileys lazy-import (ESM compat) ─────────────────────────────────────────
let _baileys = null;
async function getBaileys() {
  if (!_baileys) _baileys = await import('@whiskeysockets/baileys');
  return _baileys;
}

// ── postGroupStatusRaw ────────────────────────────────────────────────────────
/**
 * Wrap an already-built innerProto (WAProto.IMessage object) in a
 * groupStatusMessageV2 envelope and relay it to the group.
 *
 * Use this when the inner message proto is already complete (e.g. reusing an
 * existing imageMessage / videoMessage / audioMessage from a quoted message).
 */
async function postGroupStatusRaw(sock, jid, innerProto) {
  const { generateWAMessageFromContent } = await getBaileys();
  const secret = crypto.randomBytes(32);

  const fullMsg = generateWAMessageFromContent(
    jid,
    {
      groupStatusMessageV2: {
        message: {
          ...innerProto,
          messageContextInfo: { messageSecret: secret },
        },
      },
      messageContextInfo: { messageSecret: secret },
    },
    { userJid: sock.user.id }
  );

  await sock.relayMessage(jid, fullMsg.message, { messageId: fullMsg.key.id });
  return fullMsg;
}

// ── postGroupStatus ───────────────────────────────────────────────────────────
/**
 * Build the inner proto from AnyMessageContent (text or freshly-uploaded audio)
 * via generateWAMessageContent, then relay as a group story.
 *
 * Only use this for content that needs an upload (text needs no upload but
 * goes through this path; converted audio goes through here too).
 */
async function postGroupStatus(sock, jid, content) {
  const { generateWAMessageContent } = await getBaileys();
  const { backgroundColor, ...msgContent } = content;

  const innerProto = await generateWAMessageContent(msgContent, {
    upload: sock.waUploadToServer,
    ...(backgroundColor ? { backgroundColor } : {}),
  });

  return postGroupStatusRaw(sock, jid, innerProto);
}

// ── Module export ─────────────────────────────────────────────────────────────
module.exports = [
  {
    name: 'groupstatus',
    aliases: ['togstatus', 'swgc', 'gs', 'gstatus'],
    description: 'Post replied media or text as a WhatsApp group story.',
    usage: '.groupstatus [caption] [groupJid]',
    category: 'owner',
    ownerOnly: true,

    async execute(sock, msg, args, extra) {
      try {
        const from = extra.from;
        let captionArgs = [...(args || [])];
        let targetJid = null;

        // Last arg may be an explicit group JID
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
            '  `.swgc Hello everyone <groupJid>`\n' +
            '  `.swgc <groupJid>` (reply to media)'
          );
        }

        const caption = captionArgs.join(' ').trim();

        // ── Detect quoted message ─────────────────────────────────────────
        const msgContent = msg.message || {};
        const ctxInfo =
          msgContent.extendedTextMessage?.contextInfo ||
          msgContent.imageMessage?.contextInfo ||
          msgContent.videoMessage?.contextInfo ||
          msgContent.audioMessage?.contextInfo ||
          msgContent.documentMessage?.contextInfo ||
          null;
        const hasQuoted = !!ctxInfo?.quotedMessage;

        // ── TEXT STATUS ───────────────────────────────────────────────────
        if (!hasQuoted) {
          if (!caption) {
            return extra.reply(
              '📝 *Group Status Usage*\n\n' +
              '*In a group:*\n' +
              '  `.swgc Your text here`\n' +
              '  `.swgc` (reply to image/video/audio)\n\n' +
              '*From private chat:*\n' +
              '  `.swgc Hello everyone <groupJid>`\n' +
              '  `.swgc <groupJid>` (reply to media)'
            );
          }
          try {
            await postGroupStatus(sock, targetJid, {
              text: caption,
              backgroundColor: PURPLE_COLOR,
            });
            return extra.react('✅');
          } catch (e) {
            console.error('[groupstatus] text error:', e);
            return extra.reply('❌ Failed to post text status: ' + (e.message || e));
          }
        }

        // ── MEDIA STATUS ──────────────────────────────────────────────────
        const quotedMessage = ctxInfo.quotedMessage;
        const mtype = Object.keys(quotedMessage)[0] || '';

        // IMAGE ────────────────────────────────────────────────────────────
        if (mtype === 'imageMessage') {
          try {
            // Reuse existing CDN URL + mediaKey — no re-download/re-upload
            const { contextInfo, viewOnce, caption: _orig, ...mediaFields } =
              quotedMessage.imageMessage;
            const innerProto = {
              imageMessage: {
                ...mediaFields,
                caption: caption || '',
              },
            };
            await postGroupStatusRaw(sock, targetJid, innerProto);
            return extra.react('✅');
          } catch (e) {
            console.error('[groupstatus] image error:', e);
            return extra.reply('❌ Failed to post image status: ' + (e.message || e));
          }
        }

        // STICKER ──────────────────────────────────────────────────────────
        if (mtype === 'stickerMessage') {
          try {
            // Map stickerMessage → imageMessage (WebP sticker as image story)
            const { contextInfo, ...mediaFields } = quotedMessage.stickerMessage;
            const innerProto = {
              imageMessage: {
                ...mediaFields,
                mimetype: mediaFields.mimetype || 'image/webp',
                caption: caption || '',
              },
            };
            await postGroupStatusRaw(sock, targetJid, innerProto);
            return extra.react('✅');
          } catch (e) {
            console.error('[groupstatus] sticker error:', e);
            return extra.reply('❌ Failed to post sticker status: ' + (e.message || e));
          }
        }

        // VIDEO ────────────────────────────────────────────────────────────
        if (mtype === 'videoMessage') {
          try {
            // Reuse existing CDN URL + mediaKey — no re-download/re-upload
            const { contextInfo, viewOnce, caption: _orig, ...mediaFields } =
              quotedMessage.videoMessage;
            const innerProto = {
              videoMessage: {
                ...mediaFields,
                caption: caption || '',
              },
            };
            await postGroupStatusRaw(sock, targetJid, innerProto);
            return extra.react('✅');
          } catch (e) {
            console.error('[groupstatus] video error:', e);
            return extra.reply('❌ Failed to post video status: ' + (e.message || e));
          }
        }

        // AUDIO ────────────────────────────────────────────────────────────
        if (mtype === 'audioMessage') {
          const audioMsg = quotedMessage.audioMessage;
          try {
            // If already OGG/Opus PTT, reuse the existing CDN entry directly
            if (audioMsg.ptt && audioMsg.mimetype && audioMsg.mimetype.includes('opus')) {
              const { contextInfo, ...mediaFields } = audioMsg;
              const innerProto = { audioMessage: { ...mediaFields } };
              await postGroupStatusRaw(sock, targetJid, innerProto);
            } else {
              // Download, convert to OGG/Opus, then upload
              const buf = await downloadMedia(quotedMessage, 'audio');
              let vnBuf;
              try { vnBuf = await toVN(buf); } catch { vnBuf = buf; }
              let waveform;
              try { waveform = await generateWaveform(buf); } catch { waveform = undefined; }
              await postGroupStatus(sock, targetJid, {
                audio: vnBuf,
                mimetype: 'audio/ogg; codecs=opus',
                ptt: true,
                ...(waveform ? { waveform } : {}),
              });
            }
            return extra.react('✅');
          } catch (e) {
            console.error('[groupstatus] audio error:', e);
            return extra.reply('❌ Failed to post audio status: ' + (e.message || e));
          }
        }

        // DOCUMENT — post as-is using existing CDN entry
        if (mtype === 'documentMessage') {
          try {
            const { contextInfo, ...mediaFields } = quotedMessage.documentMessage;
            const innerProto = { documentMessage: { ...mediaFields } };
            await postGroupStatusRaw(sock, targetJid, innerProto);
            return extra.react('✅');
          } catch (e) {
            console.error('[groupstatus] document error:', e);
            return extra.reply('❌ Failed to post document status: ' + (e.message || e));
          }
        }

        return extra.reply(
          '❌ Unsupported media type: `' + mtype + '`\n' +
          'Reply to an image, video, audio, sticker, or document.'
        );

      } catch (e) {
        console.error('[groupstatus] outer error:', e);
        return extra.reply('❌ Error: ' + (e.message || e));
      }
    },
  },
];

// ── HELPERS ───────────────────────────────────────────────────────────────────

/**
 * Download and decrypt media from a quoted message proto.
 * msg: the quotedMessage object e.g. { audioMessage: {...} }
 * type: 'audio' | 'image' | 'video' | 'document'
 */
async function downloadMedia(msg, type) {
  const { downloadContentFromMessage } = await getBaileys();
  const mediaMsg = msg[`${type}Message`] || msg;
  const stream = await downloadContentFromMessage(mediaMsg, type);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

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
    const output = new PassThrough();
    const chunks = [];
    output.on('data', (c) => chunks.push(c));
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
      .pipe(output);
  });
}
