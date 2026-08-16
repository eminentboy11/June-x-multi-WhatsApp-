'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const addbotFlow = require('../utils/core/addbotFlow');
const sessionManager = require('../utils/core/sessionManager');

test('pause and resume preserve the registry entry and do not mutate input', () => {
  const original = [{ phone: '2348165321909', sessionId: 'JUNE-MD:~abc' }];
  const paused = addbotFlow.setRegistryPaused(original, '2348165321909', true);
  assert.equal(paused.ok, true);
  assert.equal(paused.registry[0].paused, true);
  assert.equal(original[0].paused, undefined);
  assert.equal(paused.registry[0].sessionId, original[0].sessionId);

  const resumed = addbotFlow.setRegistryPaused(paused.registry, '2348165321909', false);
  assert.equal(resumed.ok, true);
  assert.equal(resumed.registry[0].paused, undefined);
  assert.equal(resumed.registry[0].sessionId, original[0].sessionId);
});

test('pause/resume reports unknown and already-in-state safely', () => {
  const active = [{ id: 'client', phone: '2348165321909' }];
  assert.equal(addbotFlow.setRegistryPaused(active, 'missing', true).reason, 'unknown');
  assert.equal(addbotFlow.setRegistryPaused(active, 'client', false).reason, 'already-active');
  const paused = [{ ...active[0], paused: true }];
  assert.equal(addbotFlow.setRegistryPaused(paused, 'client', true).reason, 'already-paused');
});

test('startup excludes paused entries without inventing a default session', () => {
  const previous = process.env.JUNE_SESSIONS;
  process.env.JUNE_SESSIONS = JSON.stringify([
    { phone: '2348154853640', paused: true },
    { phone: '2348165321909' },
  ]);
  try {
    const loaded = sessionManager.loadSessionRegistry();
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].phone, '2348165321909');

    process.env.JUNE_SESSIONS = JSON.stringify([{ phone: '2348154853640', paused: true }]);
    assert.deepEqual(sessionManager.loadSessionRegistry(), []);
  } finally {
    if (previous === undefined) delete process.env.JUNE_SESSIONS;
    else process.env.JUNE_SESSIONS = previous;
  }
});

test('pausebot and resumebot are Super Owner control-plane commands', () => {
  for (const file of ['pausebot.js', 'resumebot.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'commands', 'botmanager', file), 'utf8');
    assert.match(source, /superOwnerOnly:\s*true/);
    assert.match(source, /superOwnerSessionOnly:\s*true/);
  }
});

test('delbot permanent path clears auth/data and removes persistent artifacts', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  assert.match(source, /permanentlyForgetSession/);
  assert.match(source, /resetDatabase\(\{ includeSession: true \}\)/);
  assert.match(source, /clearRemoteAuthState/);
  assert.match(source, /removeSessionArtifacts/);
  assert.match(source, /removeDatabaseArtifacts/);
});

test('pause protects the Super Owner control session from lockout', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  assert.match(source, /reason: 'control-session'/);
  assert.match(source, /superOwnerStatusFor\(identity\.normalized\?\.phone\)/);
});
