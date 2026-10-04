'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PauseDetector, evaluate } = require('../src/core/pause-detector');

const game = { id: 'valorant', name: 'Valorant' };
const base = { game, phase: null, integration: null, idleSeconds: 0, useIdle: true, idleThreshold: 25 };

test('intet spil = ingen pause', () => {
  assert.equal(evaluate({ ...base, game: null, idleSeconds: 999 }).state, 'noGame');
});

test('inaktivitet over grænsen giver pause', () => {
  assert.equal(evaluate({ ...base, idleSeconds: 10 }).state, 'playing');
  const r = evaluate({ ...base, idleSeconds: 30 });
  assert.equal(r.state, 'pause');
  assert.equal(r.source, 'idle');
  assert.equal(evaluate({ ...base, idleSeconds: 30, useIdle: false }).state, 'playing');
});

test('integration og lobby/kamp-processer går forud for inaktivitet', () => {
  const live = { isBreak: false, label: 'I kamp' };
  assert.equal(evaluate({ ...base, idleSeconds: 999, integration: live }).state, 'playing');
  const over = { isBreak: true, label: 'Kampen er slut' };
  assert.deepEqual(evaluate({ ...base, integration: over }), {
    state: 'pause',
    source: 'integration',
    reason: 'Kampen er slut',
  });

  assert.equal(evaluate({ ...base, phase: 'lobby' }).state, 'pause');
  assert.equal(evaluate({ ...base, phase: 'match', idleSeconds: 999 }).state, 'playing');
});

test('præcise signaler skal være stabile, før tilstanden skifter', () => {
  const d = new PauseDetector({ confirmMs: 2000 });
  const over = { isBreak: true, label: 'Kampen er slut' };
  assert.equal(d.update({ ...base, now: 0 }).state, 'playing');
  assert.equal(d.update({ ...base, now: 1000, integration: over }).state, 'playing');
  assert.equal(d.update({ ...base, now: 2000, integration: over }).state, 'playing');
  const r = d.update({ ...base, now: 3000, integration: over });
  assert.equal(r.state, 'pause');
  assert.equal(r.changed, true);
  assert.equal(r.game.name, 'Valorant');
  assert.equal(d.update({ ...base, now: 4000, integration: over }).changed, false);
});

test('inaktivitet skifter med det samme (grænsen er allerede en forsinkelse)', () => {
  const d = new PauseDetector();
  d.update({ ...base, now: 0 });
  assert.equal(d.update({ ...base, now: 1000, idleSeconds: 25 }).state, 'pause');
  assert.equal(d.update({ ...base, now: 2000, idleSeconds: 0 }).state, 'playing');
});

test('et kort udsving i et præcist signal ignoreres', () => {
  const d = new PauseDetector({ confirmMs: 2000 });
  const live = { isBreak: false, label: 'I kamp' };
  const over = { isBreak: true, label: 'Kampen er slut' };
  d.update({ ...base, now: 0, integration: live });
  assert.equal(d.update({ ...base, now: 2500, integration: live }).state, 'playing');
  d.update({ ...base, now: 3000, integration: over });
  d.update({ ...base, now: 4000, integration: live });
  // Udsvinget nulstiller ventetiden, så én enkelt "over"-besked er ikke nok.
  assert.equal(d.update({ ...base, now: 5500, integration: over }).state, 'playing');
  assert.equal(d.update({ ...base, now: 7600, integration: over }).state, 'pause');
});
