const crypto = require('crypto');
const {
  generateWAMessageContent,
  generateWAMessageFromContent,
  downloadContentFromMessage,
} = require('@whiskeysockets/baileys');
const { PassThrough } = require('stream');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('../../utils/ffmpegPath');
ffmpeg.setFfmpegPath(ffmpegPath);

const PURPLE_COLOR = '#9C27B0';

module.exports = [
  {
    name: 'groupstatus',
    aliases: ['togstatus', 'swgc', 'gs', 'gstatus'],
    description: 'Post replied media or text as a WhatsApp group status.',
    usage: '.groupstatus [caption] [groupJid]',
    category: 'owner',
    ownerOnly: true,

    async execute(sock, msg, args, extra) {
      try {
        const from = extra.from;
        let captionArgs = [...(args || [])];
        let targetJid = null;

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
        const ctxInfo = msg.message?.extendedTextMessage?.contextInfo;
        const hasQuoted = !!ctxInfo?.quotedMessage;

        // ── TEXT STATUS ──────────────────────────────────────────
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
            return extra.reply('✅ Text status posted!');
          } catch (e) {
            console.error('[groupstatus] text error:', e);
            return extra.reply('❌ Failed to post text status: ' + (e.message || e));
          }
        }

        // ── MEDIA STATUS ─────────────────────────────────────────
        const quotedMsg = {
          key: {
            remoteJid: from,
            id: ctxInfo.stanzaId,
            participant: ctxInfo.participant,
          },
          message: ctxInfo.quotedMessage,
        };

        const mtype = Object.keys(quotedMsg.message)[0] || '';

        // IMAGE / STICKER
        if (/image|sticker/i.test(mtype)) {
          let buf;
          try {
            buf = await downloadMedia(quotedMsg.message, /sticker/i.test(mtype) ? 'sticker' : 'image');
          } catch {
            return extra.reply('❌ Failed to download image/sticker.');
          }

          try {
            await postGroupStatus(sock, targetJid, {
              image: buf,
              caption: caption || '',
            });
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
            buf = await downloadMedia(quotedMsg.message, 'video');
          } catch {
            return extra.reply('❌ Failed to download video.');
          }

          try {
            await postGroupStatus(sock, targetJid, {
              video: buf,
              caption: caption || '',
            });
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
            buf = await downloadMedia(quotedMsg.message, 'audio');
          } catch {
            return extra.reply('❌ Failed to download audio.');
          }

          let vnBuf;
          try {
            vnBuf = await toVN(buf);
          } catch {
            vnBuf = buf;
          }

          let waveform;
          try {
            waveform = await generateWaveform(buf);
          } catch {
            waveform = undefined;
          }

          try {
            await postGroupStatus(sock, targetJid, {
              audio: vnBuf,
              mimetype: 'audio/ogg; codecs=opus',
              ptt: true,
              waveform,
            });
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
  },
];

// ── HELPERS ───────────────────────────────────────────────────────────────────

async function downloadMedia(msg, type) {
  const mediaMsg = msg[`${type}Message`] || msg;
  const stream = await downloadContentFromMessage(mediaMsg, type);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function postGroupStatus(sock, jid, content) {
  const backgroundColor = content.backgroundColor;
  delete content.backgroundColor;

  const inside = await generateWAMessageContent(content, {
    upload: sock.waUploadToServer,
    jid,
    ...(backgroundColor && { backgroundColor }),
  });

  const secret = crypto.randomBytes(32);

  const msg = generateWAMessageFromContent(
    jid,
    {
      messageContextInfo: { messageSecret: secret },
      groupStatusMessageV2: {
        message: {
          ...inside,
          messageContextInfo: { messageSecret: secret },
        },
      },
    },
    {
      userJid: sock.user.id,
    }
  );

  await sock.relayMessage(jid, msg.message, { messageId: msg.key.id });
  return msg;
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
