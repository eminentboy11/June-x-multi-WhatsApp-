/**
 * Group Status — post text, image, video or audio to a group's story (WhatsApp Group Status)
 * Compatible with @whiskeysockets/baileys v7.0.0-rc.10
 */

const crypto = require('crypto');
const {
  generateWAMessageContent,
  generateWAMessageFromContent,
  prepareWAMessageMedia,
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

      const ctxInfo = msg.message?.extendedTextMessage?.contextInfo
        || msg.message?.imageMessage?.contextInfo
        || msg.message?.videoMessage?.contextInfo
        || msg.message?.audioMessage?.contextInfo;

      const hasQuoted = !!ctxInfo?.quotedMessage;

      // CASE 1: No quoted message → text group status
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
          console.error('groupstatus text error:', e);
          return extra.reply('❌ Failed to post text group status: ' + (e.message || e));
        }
      }

      // CASE 2: Quoted media
      const targetMessage = {
        key: {
          remoteJid: from,
          id: ctxInfo.stanzaId,
          participant: ctxInfo.participant,
        },
        message: ctxInfo.quotedMessage,
      };

      const mtype = Object.keys(targetMessage.message)[0] || '';

      // IMAGE / STICKER
      if (/image|sticker/i.test(mtype)) {
        let buf;
        try {
          buf = await downloadMedia(targetMessage.message, /sticker/i.test(mtype) ? 'sticker' : 'image');
        } catch (e) {
          return extra.reply('❌ Failed to download image: ' + e.message);
        }
        if (!buf) return extra.reply('❌ Could not download image');

        try {
          await sendGroupStatus(sock, targetJid, {
            type: 'image',
            buffer: buf,
            caption: caption || '',
          });
          return extra.reply('✅ Image status posted!');
        } catch (e) {
          console.error('groupstatus image error:', e);
          return extra.reply('❌ Failed to post image group status: ' + (e.message || e));
        }
      }

      // VIDEO
      if (/video/i.test(mtype)) {
        let buf;
        try {
          buf = await downloadMedia(targetMessage.message, 'video');
        } catch (e) {
          return extra.reply('❌ Failed to download video: ' + e.message);
        }
        if (!buf) return extra.reply('❌ Could not download video');

        try {
          await sendGroupStatus(sock, targetJid, {
            type: 'video',
            buffer: buf,
            caption: caption || '',
          });
          return extra.reply('✅ Video status posted!');
        } catch (e) {
          console.error('groupstatus video error:', e);
          return extra.reply('❌ Failed to post video group status: ' + (e.message || e));
        }
      }

      // AUDIO
      if (/audio/i.test(mtype)) {
        let buf;
        try {
          buf = await downloadMedia(targetMessage.message, 'audio');
        } catch (e) {
          return extra.reply('❌ Failed to download audio: ' + e.message);
        }
        if (!buf) return extra.reply('❌ Could not download audio');

        let vn = buf;
        try { vn = await toVN(buf); } catch (_) {}

        let waveform;
        try { waveform = await generateWaveform(buf); } catch (_) {}

        try {
          await sendGroupStatus(sock, targetJid, {
            type: 'audio',
            buffer: vn,
            waveform,
          });
          return extra.reply('✅ Audio status posted!');
        } catch (e) {
          console.error('groupstatus audio error:', e);
          return extra.reply('❌ Failed to post audio group status: ' + (e.message || e));
        }
      }

      return extra.reply('❌ Unsupported media type. Reply to an image, video, or audio.');
    } catch (e) {
      console.error('groupstatus command error (outer):', e);
      return extra.reply('❌ Error: ' + (e.message || e));
    }
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────────

async function downloadMedia(msg, type) {
  const mediaMsg = msg[`${type}Message`] || msg;
  const stream = await downloadContentFromMessage(mediaMsg, type);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/**
 * Send a group status (group story) message.
 * Uses prepareWAMessageMedia for media types so that uploads work correctly
 * with Baileys v7.0.0-rc.10.
 */
async function sendGroupStatus(sock, jid, content) {
  const secret = crypto.randomBytes(32);
  let inside;

  if (content.type === 'text') {
    inside = await generateWAMessageContent(
      { text: content.text },
      {
        upload: sock.waUploadToServer,
        backgroundColor: content.backgroundColor || PURPLE_COLOR,
      }
    );
  } else if (content.type === 'image') {
    const prepared = await prepareWAMessageMedia(
      { image: content.buffer },
      { upload: sock.waUploadToServer }
    );
    inside = {
      imageMessage: {
        ...prepared.imageMessage,
        caption: content.caption || '',
      },
    };
  } else if (content.type === 'video') {
    const prepared = await prepareWAMessageMedia(
      { video: content.buffer },
      { upload: sock.waUploadToServer }
    );
    inside = {
      videoMessage: {
        ...prepared.videoMessage,
        caption: content.caption || '',
      },
    };
  } else if (content.type === 'audio') {
    const prepared = await prepareWAMessageMedia(
      {
        audio: content.buffer,
        mimetype: 'audio/ogg; codecs=opus',
        ptt: true,
      },
      { upload: sock.waUploadToServer }
    );
    inside = {
      audioMessage: {
        ...prepared.audioMessage,
        waveform: content.waveform,
        ptt: true,
      },
    };
  } else {
    throw new Error('Unknown group status content type: ' + content.type);
  }

  const outMsg = generateWAMessageFromContent(
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
    {}
  );

  await sock.relayMessage(jid, outMsg.message, { messageId: outMsg.key.id });
  return outMsg;
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
