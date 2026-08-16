'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const adapters = {
  postgres: require('../utils/juneDb/pgAdapter'),
  mongo: require('../utils/juneDb/mongoAdapter'),
};

for (const [name, registry] of Object.entries(adapters)) {
  test(`${name}: unregister removes only the selected bot and re-add is fresh`, async () => {
    const targetId = `${name}-target`;
    const otherId = `${name}-other`;
    const target = registry.forBot(targetId);
    const other = registry.forBot(otherId);

    assert.equal(typeof registry.unregister, 'function');
    assert.equal(registry.unregister(targetId), true);
    assert.equal(registry.listBotIds().includes(targetId), false);
    assert.equal(registry.listBotIds().includes(otherId), true);
    assert.equal(registry.forBot(otherId), other);

    const replacement = registry.forBot(targetId);
    assert.notEqual(replacement, target);
    assert.equal(registry.unregister('does-not-exist'), false);

    registry.unregister(targetId);
    registry.unregister(otherId);
    await Promise.allSettled([target.close(), replacement.close(), other.close()]);
  });
}

test('index hot-remove dependencies expose unregister', () => {
  assert.equal(typeof adapters.postgres.unregister, 'function');
  assert.equal(typeof adapters.mongo.unregister, 'function');
});
