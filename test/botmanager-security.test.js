'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const managerDir = path.join(__dirname, '..', 'commands', 'botmanager');
const commandFiles = fs.readdirSync(managerDir)
  .filter((name) => name.endsWith('.js'))
  .sort();

test('every Bot Manager command requires Super Owner sender and control session', () => {
  assert.ok(commandFiles.length > 0);
  for (const name of commandFiles) {
    const source = fs.readFileSync(path.join(managerDir, name), 'utf8');
    assert.match(source, /superOwnerOnly:\s*true/, `${name} must require Super Owner sender`);
    assert.match(source, /superOwnerSessionOnly:\s*true/, `${name} must run only on the Super Owner session`);
    assert.doesNotMatch(source, /ownerOnly:\s*true/, `${name} must not use the weaker owner-only gate`);
  }
});

test('handler includes LID alternate candidates and silent control-session gate', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'handler.js'), 'utf8');
  assert.match(source, /msg\.key\.participantAlt/);
  assert.match(source, /platformSenderCandidates/);
  assert.match(source, /command\.superOwnerSessionOnly/);
  assert.match(source, /isBotManagerControlSession\(sock\)/);
});

test('superowner diagnostic consumes the handler-resolved sender', () => {
  const source = fs.readFileSync(path.join(managerDir, 'superowner.js'), 'utf8');
  assert.match(source, /extra\.resolvedSender\s*\|\|\s*extra\.sender/);
});
