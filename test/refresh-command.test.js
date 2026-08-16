'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { runInBot } = require('../utils/core/botContext');
const refresh = require('../commands/botmanager/refresh');

test('.refresh sends confirmation through the replacement socket', async () => {
  const events = new EventEmitter();
  const sent = [];
  const replies = [];
  const freshSocket = {
    ev: events,
    async sendMessage(jid, content) {
      sent.push({ jid, content });
    },
  };

  const previousHook = global.__JUNE_RESTART_SESSION;
  let requestedBotId;
  global.__JUNE_RESTART_SESSION = async (botId) => {
    requestedBotId = botId;
    return { ok: true, id: botId, sock: freshSocket, connected: true };
  };

  try {
    await runInBot('refresh-test', () => refresh.execute(
      {},
      { key: { remoteJid: 'chat@s.whatsapp.net' } },
      [],
      { reply: async (text) => replies.push(text) }
    ));
  } finally {
    global.__JUNE_RESTART_SESSION = previousHook;
  }

  assert.equal(requestedBotId, 'refresh-test');
  assert.deepEqual(replies, ['🔁 Refreshing this session...']);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].jid, 'chat@s.whatsapp.net');
  assert.match(sent[0].content.text, /refreshed successfully/i);
});

test('confirmation waits for connection-open when the fresh socket is not ready', async () => {
  const events = new EventEmitter();
  const sent = [];
  let online = false;
  const freshSocket = {
    ev: events,
    async sendMessage(jid, content) {
      if (!online) throw new Error('not connected');
      sent.push({ jid, content });
    },
  };

  const delivery = refresh._sendWhenFreshSocketIsReady(
    freshSocket,
    'chat@s.whatsapp.net',
    '✅ Session refreshed successfully.',
    1000
  );

  await new Promise((resolve) => setImmediate(resolve));
  online = true;
  events.emit('connection.update', { connection: 'open' });

  assert.equal(await delivery, true);
  assert.equal(sent.length, 1);
});
