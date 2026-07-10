/**
 * Shared helper to resolve a quoted message's contextInfo across every
 * wrapper WhatsApp can send a reply through (plain text, button reply,
 * list reply). Several commands (audio effects, tomp3, toptt, tovideo)
 * previously only checked `extendedTextMessage`, so replying via a
 * button/list response silently failed to find the quoted audio/video.
 *
 * @param {object} msg - The incoming message object
 * @returns {{ ctx: object, quotedMessage: object } | null}
 */
function getQuotedContext(msg) {
  const candidates = [
    msg.message?.extendedTextMessage?.contextInfo,
    msg.message?.buttonsResponseMessage?.contextInfo,
    msg.message?.listResponseMessage?.contextInfo,
  ];

  for (const ctx of candidates) {
    if (ctx?.quotedMessage) {
      return { ctx, quotedMessage: ctx.quotedMessage };
    }
  }
  return null;
}

/**
 * Build a synthetic message object (with proper key) for the quoted
 * message so it can be passed to downloadMediaMessage / other helpers
 * that expect a full message shape.
 *
 * @param {object} msg - The incoming message object
 * @returns {{ ctx: object, quotedMessage: object, fullQuoted: object } | null}
 */
function resolveQuoted(msg) {
  const found = getQuotedContext(msg);
  if (!found) return null;
  const { ctx, quotedMessage } = found;
  const fullQuoted = {
    key: {
      remoteJid: ctx.remoteJid || msg.key.remoteJid,
      fromMe: false,
      id: ctx.stanzaId,
      participant: ctx.participant,
    },
    message: quotedMessage,
  };
  return { ctx, quotedMessage, fullQuoted };
}

module.exports = { getQuotedContext, resolveQuoted };
