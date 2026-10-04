'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GamepadActivity } = require('../src/core/gamepad-activity');

const pad = (overrides = {}) => ({
  wButtons: 0,
  bLeftTrigger: 0,
  bRightTrigger: 0,
  sThumbLX: 0,
  sThumbLY: 0,
  sThumbRX: 0,
  sThumbRY: 0,
  ...overrides,
});
const state = (packet, overrides) => ({ dwPacketNumber: packet, Gamepad: pad(overrides) });

test('ingen controller = ingen aktivitet', () => {
  const g = new GamepadActivity();
  assert.equal(g.update(0, null, 1000), false);
  assert.equal(g.idleSeconds(5000), Infinity);
  assert.equal(g.connected, 0);
});

test('knapper, triggere og pinde tæller som aktivitet', () => {
  const g = new GamepadActivity();
  assert.equal(g.update(0, state(1), 0), false);
  assert.equal(g.update(0, state(2, { wButtons: 0x1000 }), 1000), true); // A-knappen
  assert.equal(g.idleSeconds(4000), 3);
  assert.equal(g.update(0, state(3, { bRightTrigger: 200 }), 5000), true);
  assert.equal(g.update(0, state(4, { sThumbLX: -20000 }), 6000), true);
  assert.equal(g.connected, 1);
});

test('små udsving på pindene (drift) tæller ikke', () => {
  const g = new GamepadActivity();
  g.update(0, state(1, { sThumbLX: 1200, sThumbRY: -900 }), 0);
  assert.equal(g.update(0, state(2, { sThumbLX: 1500, sThumbRY: -1100 }), 1000), false);
  assert.equal(g.update(0, state(3, { sThumbLX: 1300 }), 2000), false);
  assert.equal(g.idleSeconds(2000), Infinity);
});

test('en knap der slippes mellem to aflæsninger tæller (pakkenummeret ændres)', () => {
  const g = new GamepadActivity();
  g.update(1, state(10, { wButtons: 0x0001 }), 0);
  assert.equal(g.update(1, state(11), 250), true);
  assert.equal(g.update(1, state(11), 500), false);
});
