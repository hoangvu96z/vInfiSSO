import assert from 'node:assert/strict';
import test from 'node:test';
import { createLatestRequestGate } from './requestGate.js';

test('latest request gate invalidates older requests and unmounted work', () => {
  const gate = createLatestRequestGate();
  const firstRequest = gate.begin();
  const secondRequest = gate.begin();

  assert.equal(gate.isCurrent(firstRequest), false);
  assert.equal(gate.isCurrent(secondRequest), true);

  gate.invalidate();
  assert.equal(gate.isCurrent(secondRequest), false);
});

test('stale async completion cannot overwrite the latest request result', async () => {
  const gate = createLatestRequestGate();
  let resolveOlder;
  const olderResponse = new Promise((resolve) => { resolveOlder = resolve; });
  const olderRequestId = gate.begin();
  const olderCompletion = olderResponse.then((value) => {
    if (gate.isCurrent(olderRequestId)) return value;
    return undefined;
  });

  const latestRequestId = gate.begin();
  const latestValue = 'latest';
  const appliedLatest = gate.isCurrent(latestRequestId) ? latestValue : undefined;
  resolveOlder('stale');

  assert.equal(await olderCompletion, undefined);
  assert.equal(appliedLatest, 'latest');
});
